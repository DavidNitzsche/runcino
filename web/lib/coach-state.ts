/**
 * Coach state aggregator.
 *
 * One function — gatherCoachState() — that walks Postgres and produces
 * the single typed object the coaching engine needs to make decisions.
 * Everything Coach reads goes through here so we don't accidentally
 * scatter half the data picture across multiple routes.
 *
 * Read sources:
 *   - races + actualResult     → race calendar + recent finishes
 *   - strava_activities        → volume, intensity, recent execution
 *   - HealthKit (M2 placeholder) → HRV / RHR / sleep
 *
 * The engine itself is in lib/coach-engine.ts. State and engine are
 * intentionally split so the engine can be replaced wholesale once
 * the research doc lands without touching the data plumbing.
 */

import { listRacesDB } from './race-store';
import { getCachedActivities } from './strava-cache';
import { isProbablyRace, currentWeekDays, weeklyMiles, effortBalance } from './strava-stats';
import { todayISO as todayLAISO, todayDate } from './dates';
import type { NormalizedActivity } from '../app/api/strava/activities/route-shared';
import type { SavedRace } from './storage-types';
import { POST_RACE_BY_DISTANCE } from '../coach/doctrine';
import { postRaceDistanceBand } from './recovery-distance';

export interface CoachState {
  /** ISO date the state was gathered. Engine should treat this as "today". */
  now: string;

  /** Race calendar — calendar-aware decisions cascade off here. */
  races: {
    /** Next A race in the future (closest by date). null = base mode candidate. */
    nextA: NextRace | null;
    /** Next race of any priority (A/B/C). May equal nextA. */
    nextAny: NextRace | null;
    /** Every race in the future within a distance-aware build window from today. */
    inWindow: NextRace[];
    /** Races finished in the last 28 days, newest first. Sized for
     *  heavy-block detection and recovery-window math, NOT for VDOT
     *  (use racesForVdot for that — it has the wider 56-day window
     *  Daniels recommends for current-fitness signals). */
    recent: PastRace[];
    /** Races finished in the last 56 days (Daniels' 8-week freshness
     *  window for VDOT inputs). Newest first. The VDOT pipeline
     *  walks this and picks the strongest by derived VDOT. Doctrine:
     *  VDOT_FRESHNESS_WINDOW (Research/01). */
    racesForVdot: PastRace[];
    /** Number of races (any priority) finished in the last 30 days. Heavy-block signal. */
    raceCount30d: number;
  };

  /** Volume signals — pulled from Strava activities. */
  volume: {
    last7Mi: number;
    last28Mi: number;
    /** Last 7 days as daily totals (oldest → today). */
    last7Days: Array<{ date: string; miles: number; runs: number }>;
    weeklyAvg4w: number;
    weeklyAvg8w: number;
    /** Longest single run in the last 28 days. */
    longestLast28Mi: number;
    /** Recent 4w vs prior 4w. null when prior is 0 (no signal). */
    deltaPct4v4: number | null;
  };

  /** Intensity distribution (80/20 polarized check). */
  intensity: {
    easyMi14d: number;
    hardMi14d: number;
    /** 0–1, mile-weighted by HR threshold. */
    easyShare14d: number;
  };

  /** Recovery + readiness. HealthKit fields are null until M2 ships. */
  recovery: {
    /** Days since the last logged run (0 if today). */
    daysSinceLastRun: number;
    /** Consecutive calendar days with at least one run, ending today (or yesterday). */
    consecutiveRunDays: number;
    /** Yesterday's run summary, if any. */
    yesterday: { distMi: number; paceSPerMi: number; avgHr: number | null; name: string; activityId: number } | null;
    /** Today's run summary, if any. Drives mid-day reconciliation:
     *  if the user runs after the morning prescription, the coach
     *  reads this to revise the day's voice + adjust tomorrow. */
    today: { distMi: number; paceSPerMi: number; avgHr: number | null; name: string; activityId: number } | null;
    /** M2 — HealthKit-driven. */
    hrv7dAvgMs: number | null;
    rhrBpm: number | null;
    sleep7dAvgHrs: number | null;
    /** Strength sessions logged in the current calendar week. Sourced
     *  from Amp (eventually) or HealthKit workouts categorized as
     *  strength training. Null until that pipeline lands. */
    strengthDaysThisWeek: number | null;
  };

  /** Runner demographic + physio profile, server-sourced from the
   *  `runner_profile` Postgres table (lib/runner-profile-store.ts).
   *  Drives HR-threshold computation, age-grading, sex-cohort framing.
   *  All fields nullable — empty profile is valid, engine falls
   *  back to defaults (e.g. HARD_EFFORT_HR_DEFAULT_BPM 152). */
  runner: {
    age: number | null;
    sex: 'male' | 'female' | 'other' | 'unspecified';
    hrmaxBpm: number | null;
    rhrBpm: number | null;
    /** Resolved HRmax — measured if set, otherwise Tanaka estimate
     *  from age, otherwise null. The engine uses this for threshold
     *  derivation: 80% × hrmax = "yesterday was hard" cutoff. */
    resolvedHrmaxBpm: number | null;
    /** Day-of-week the runner wants their long run placed on
     *  (0=Sun..6=Sat). NULL → defaults to Sunday. Drives both
     *  defaultByDow's long-run anchor + the longer rebuild day in
     *  postRaceWorkout's stage 3/4 weeks. Sourced from
     *  runner_profile.long_run_dow. */
    longRunDow: number | null;
  };

  /** Recent post-workout RPE history (Borg CR-10), most recent first.
   *  Sourced from `workout_rpe` Postgres table. Engine consumes this
   *  to detect perceived-effort drift between similarly-prescribed
   *  sessions — Research/00b §INCOMPLETE_RECOVERY_QUALITATIVE_SIGNALS.
   *  Empty array when the runner hasn't logged any. */
  rpe: {
    /** Last 14 days of entries, most recent first. */
    recent: Array<{ workoutDate: string; rpe: number; notes: string | null }>;
    /** Average RPE last 7d (null when no entries). */
    avg7d: number | null;
    /** Average RPE prior 7d (days 8-14). Null when no entries. */
    avgPrior7d: number | null;
    /** Drift = avg7d - avgPrior7d. Positive = "trending heavy",
     *  negative = "trending light", null = insufficient data. */
    drift: number | null;
    /** True if any of the last 3 days has RPE ≥ 8 — suggests perceived
     *  effort is exceeding what the prescription expected. */
    recentHeavy: boolean;
  };

  /** Engine-readable flags so it doesn't have to recompute these. */
  flags: {
    /** True when ANY of: 2+ races in 14 days; a marathon-distance race
     *  in the last 14 days; 3+ races in 21 days; sustained ≥1.5× weekly
     *  average for 3+ weeks. Drives a deeper rest schedule than a
     *  single-race POST_RACE — Big Sur + Sombrero (8 days apart)
     *  qualifies and means the coach holds on running for longer. */
    heavyBlockSuspected: boolean;
    /** Last-7-day mileage ≤ 30% of 28-day average → coming back from a break. */
    rebuildAfterBreak: boolean;
    /** True once HealthKit data is flowing. Engine uses this to decide which rules to trust. */
    healthKitAvailable: boolean;
  };

  /** ISO date when the LATEST race-recovery window closes. Each
   *  recent race contributes a window; this picks the furthest-out
   *  end-date. Engine treats `today < recoveryWindowEndsISO` as
   *  POST_RACE phase regardless of the 14-day default. So a marathon
   *  21 days ago still keeps the runner in POST_RACE if its window
   *  hasn't closed.
   *
   *  Distance-driven recovery durations (doc §13.3 + 1-day-per-mile):
   *    Marathon:    26 days
   *    Half:        14 days
   *    10K:          7 days
   *    5K:           3 days */
  recoveryWindowEndsISO: string | null;
}

interface NextRace {
  slug: string;
  name: string;
  date: string;
  distanceMi: number;
  goalDisplay: string;
  goalFinishS: number | null;
  /** Goal pace in seconds-per-mile, derived from goalFinishS /
   *  distanceMi. Null when no goal time is set. The engine layers
   *  this with VDOT-derived paces — VDOT tells us what the runner
   *  CAN do today; goalPaceSPerMi tells us what the workout SHOULD
   *  feel like to be on track. */
  goalPaceSPerMi: number | null;
  priority: 'A' | 'B' | 'C';
  daysAway: number;
}

interface PastRace {
  slug: string | null;          // null when it's a Strava-only race (not saved)
  activityId: number | null;
  name: string;
  date: string;
  distanceMi: number;
  finishS: number | null;
  daysAgo: number;
}

/** Lightweight VDOT lookup — same VDOT_LOOKUP_TABLE as
 *  coach/doctrine/pace_zones.ts, inlined to avoid a circular import
 *  via lib/vdot.ts (which imports CoachState's types). Used to
 *  derive the runner's current VDOT estimate inside gatherCoachState
 *  for the intensity classifier. Linear interp between table rows. */
const VDOT_LOOKUP_FOR_STATE = [
  // Subset matching the canonical table; each row maps a race
  // distance in seconds to a VDOT.
  { vdot: 30, mileS: 510, km3S: 1047, km5S: 1840, km10S: 3826, km15S: 5894, halfS: 8464,  marathonS: 17357 },
  { vdot: 35, mileS: 444, km3S: 914,  km5S: 1612, km10S: 3361, km15S: 5183, halfS: 7448,  marathonS: 15300 },
  { vdot: 40, mileS: 395, km3S: 815,  km5S: 1448, km10S: 3003, km15S: 4633, halfS: 6659,  marathonS: 13785 },
  { vdot: 45, mileS: 356, km3S: 737,  km5S: 1310, km10S: 2716, km15S: 4193, halfS: 6020,  marathonS: 12506 },
  { vdot: 50, mileS: 324, km3S: 671,  km5S: 1197, km10S: 2481, km15S: 3826, halfS: 5495,  marathonS: 11449 },
  { vdot: 55, mileS: 298, km3S: 614,  km5S: 1102, km10S: 2286, km15S: 3524, halfS: 5058,  marathonS: 10561 },
  { vdot: 60, mileS: 276, km3S: 567,  km5S: 1023, km10S: 2122, km15S: 3275, halfS: 4689,  marathonS: 9805  },
  { vdot: 65, mileS: 258, km3S: 528,  km5S: 954,  km10S: 1981, km15S: 3063, halfS: 4375,  marathonS: 9155  },
  { vdot: 70, mileS: 243, km3S: 495,  km5S: 895,  km10S: 1859, km15S: 2878, halfS: 4101,  marathonS: 8590  },
  { vdot: 75, mileS: 230, km3S: 465,  km5S: 843,  km10S: 1754, km15S: 2718, halfS: 3863,  marathonS: 8095  },
  { vdot: 80, mileS: 218, km3S: 441,  km5S: 798,  km10S: 1662, km15S: 2581, halfS: 3654,  marathonS: 7658  },
] as const;

type VdotKey = 'mileS' | 'km3S' | 'km5S' | 'km10S' | 'km15S' | 'halfS' | 'marathonS';

function quickDistanceKey(distMi: number): VdotKey | null {
  const candidates: Array<{ key: VdotKey; mi: number }> = [
    { key: 'mileS',     mi: 1 },
    { key: 'km3S',      mi: 1.864 },
    { key: 'km5S',      mi: 3.107 },
    { key: 'km10S',     mi: 6.214 },
    { key: 'km15S',     mi: 9.321 },
    { key: 'halfS',     mi: 13.109 },
    { key: 'marathonS', mi: 26.219 },
  ];
  for (const c of candidates) {
    if (Math.abs(distMi - c.mi) / c.mi < 0.05) return c.key;
  }
  return null;
}

function quickVdotFromRace(distMi: number, timeS: number): number | null {
  const key = quickDistanceKey(distMi);
  if (!key) return null;
  const rows = VDOT_LOOKUP_FOR_STATE;
  for (let i = 0; i < rows.length - 1; i++) {
    const hi = rows[i], lo = rows[i + 1];
    if (timeS <= hi[key] && timeS >= lo[key]) {
      const t = (hi[key] - timeS) / (hi[key] - lo[key]);
      return Math.round((hi.vdot + t * (lo.vdot - hi.vdot)) * 10) / 10;
    }
  }
  if (timeS > rows[0][key]) return rows[0].vdot;
  if (timeS < rows[rows.length - 1][key]) return rows[rows.length - 1].vdot;
  return null;
}

function parseGoalHMS(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/** Distance-aware build window. Marathon needs 16w of structured build,
 *  half 12w, 10K 8w, 5K 6w. Anything shorter or longer falls in the
 *  same bucket as the closest. */
function buildWindowDays(distanceMi: number): number {
  if (distanceMi >= 20) return 16 * 7;
  if (distanceMi >= 10) return 12 * 7;
  if (distanceMi >= 5)  return 8 * 7;
  return 6 * 7;
}

export async function gatherCoachState(): Promise<CoachState> {
  // "Today" in LA — server runs in UTC and would otherwise flip a day
  // early in the evening. todayDate() is anchored at noon UTC of the
  // LA calendar date so isoDateOffset's setDate/getDate math is safe.
  const today = todayDate();
  const todayISO = todayLAISO();

  const [savedRaces, { activities }] = await Promise.all([
    listRacesDB(),
    getCachedActivities().catch(() => ({ activities: [] as NormalizedActivity[], fetchedAt: 0 })),
  ]);

  // ── Race calendar ─────────────────────────────────────────
  const futureSaved = savedRaces
    .filter(r => r.meta.date >= todayISO)
    .sort((a, b) => a.meta.date.localeCompare(b.meta.date))
    .map(toNextRace);
  const nextAny = futureSaved[0] ?? null;
  const nextA = futureSaved.find(r => r.priority === 'A') ?? null;
  const inWindow = futureSaved.filter(r => r.daysAway <= buildWindowDays(r.distanceMi));

  // Recent past races: 28-day window. Pull from BOTH saved races and
  // Strava-flagged activities so retro-untagged historical races still
  // count toward heavy-block detection.
  const cutoff28 = isoDateOffset(today, -28);
  const recentSaved = savedRaces
    .filter(r => r.meta.date >= cutoff28 && r.meta.date <= todayISO && r.actualResult)
    .map<PastRace>(r => ({
      slug: r.slug, activityId: r.actualResult?.stravaActivityId ?? null,
      name: r.meta.name, date: r.meta.date, distanceMi: r.meta.distanceMi,
      finishS: r.actualResult?.finishS ?? null,
      daysAgo: daysBetween(r.meta.date, todayISO),
    }));
  const savedActIds = new Set(recentSaved.map(r => r.activityId).filter((id): id is number => id != null));
  const recentStrava = activities
    .filter(a => a.date >= cutoff28 && a.date <= todayISO && isProbablyRace(a) && !savedActIds.has(a.id))
    .map<PastRace>(a => ({
      slug: null, activityId: a.id,
      name: a.name, date: a.date, distanceMi: a.distanceMi,
      finishS: a.movingTimeS,
      daysAgo: daysBetween(a.date, todayISO),
    }));
  const recent = [...recentSaved, ...recentStrava].sort((a, b) => b.date.localeCompare(a.date));

  // VDOT freshness window: 56 days (Daniels' 8-week rule, doctrine
  // VDOT_FRESHNESS_WINDOW). Walks the same saved-races + Strava-flagged
  // sources as `recent`, just on a wider cutoff. Kept separate from
  // `recent` because the 28d window is right for heavy-block detection
  // but too tight for current-fitness inference.
  const cutoff56 = isoDateOffset(today, -56);
  const vdotSaved = savedRaces
    .filter(r => r.meta.date >= cutoff56 && r.meta.date <= todayISO && r.actualResult)
    .map<PastRace>(r => ({
      slug: r.slug, activityId: r.actualResult?.stravaActivityId ?? null,
      name: r.meta.name, date: r.meta.date, distanceMi: r.meta.distanceMi,
      finishS: r.actualResult?.finishS ?? null,
      daysAgo: daysBetween(r.meta.date, todayISO),
    }));
  const vdotSavedActIds = new Set(vdotSaved.map(r => r.activityId).filter((id): id is number => id != null));
  const vdotStrava = activities
    .filter(a => a.date >= cutoff56 && a.date <= todayISO && isProbablyRace(a) && !vdotSavedActIds.has(a.id))
    .map<PastRace>(a => ({
      slug: null, activityId: a.id,
      name: a.name, date: a.date, distanceMi: a.distanceMi,
      finishS: a.movingTimeS,
      daysAgo: daysBetween(a.date, todayISO),
    }));
  const racesForVdot = [...vdotSaved, ...vdotStrava].sort((a, b) => b.date.localeCompare(a.date));

  const cutoff30 = isoDateOffset(today, -30);
  const raceCount30d = activities.filter(a => a.date >= cutoff30 && a.date <= todayISO && isProbablyRace(a)).length
    + savedRaces.filter(r => r.meta.date >= cutoff30 && r.meta.date <= todayISO && r.actualResult).length;

  // ── Volume ────────────────────────────────────────────────
  const cutoff7 = isoDateOffset(today, -7);
  const last7 = activities.filter(a => a.date >= cutoff7 && a.date <= todayISO);
  const last7Mi = round1(last7.reduce((s, a) => s + a.distanceMi, 0));
  const last28 = activities.filter(a => a.date >= cutoff28 && a.date <= todayISO);
  const last28Mi = round1(last28.reduce((s, a) => s + a.distanceMi, 0));
  const last7Days = currentWeekDays(activities)
    .map(d => ({ date: d.date, miles: d.miles, runs: d.runs }));  // already calendar Mon-Sun

  const weeks8 = weeklyMiles(activities, 8);
  const recent4 = weeks8.slice(-4); const prior4 = weeks8.slice(0, 4);
  const recent4wkMi = recent4.reduce((s, w) => s + w.miles, 0);
  const prior4wkMi  = prior4.reduce((s, w) => s + w.miles, 0);
  const weeklyAvg4w = round1(recent4wkMi / 4);
  const weeklyAvg8w = round1((recent4wkMi + prior4wkMi) / 8);
  const deltaPct4v4 = prior4wkMi > 0 ? (recent4wkMi - prior4wkMi) / prior4wkMi : null;
  // Filter out races so a 26.2mi marathon doesn't pose as the
  // runner's "longest run" — the long-run-spike rule (10% over) would
  // then cap day-X long_steady at 28.8mi, which is absurd. The cap
  // should track training long runs only.
  const last28NonRace = last28.filter(a => !isProbablyRace(a));
  const longestLast28Mi = last28NonRace.length > 0 ? round1(Math.max(...last28NonRace.map(a => a.distanceMi))) : 0;

  // ── Intensity ─────────────────────────────────────────────
  // Derive a current-VDOT estimate from the strongest race in the
  // freshness window, so the effort classifier can use Daniels'
  // pace-zone signals (E zone = easy, M-pace-and-faster = hard).
  // Inline the VDOT lookup here to avoid a circular import on
  // lib/vdot.ts (which depends on this file's types).
  const stateVdot = (() => {
    let best: number | null = null;
    for (const r of racesForVdot) {
      if (r.finishS == null || r.distanceMi <= 0) continue;
      const v = quickVdotFromRace(r.distanceMi, r.finishS);
      if (v != null && (best == null || v > best)) best = v;
    }
    return best;
  })();
  const balance = effortBalance(activities, 14, 152, stateVdot);

  // ── Recovery ──────────────────────────────────────────────
  const sortedByDate = activities.slice().sort((a, b) => b.startLocal.localeCompare(a.startLocal));
  const lastRun = sortedByDate[0] ?? null;
  const daysSinceLastRun = lastRun ? daysBetween(lastRun.date, todayISO) : Infinity;
  const yesterdayISO = isoDateOffset(today, -1);
  const yesterdayRun = activities.find(a => a.date === yesterdayISO) ?? null;
  const todayRun = activities.find(a => a.date === todayISO) ?? null;
  let consecutiveRunDays = 0;
  for (let i = 0; i < 60; i++) {
    const d = isoDateOffset(today, -i);
    if (activities.some(a => a.date === d)) consecutiveRunDays++;
    else if (i === 0) continue;  // today might have no run yet — start streak from yesterday
    else break;
  }

  // ── Flags ─────────────────────────────────────────────────
  const cutoff21 = isoDateOffset(today, -21);
  const cutoff14 = isoDateOffset(today, -14);
  const recentRaceCount21 = activities.filter(a => a.date >= cutoff21 && a.date <= todayISO && isProbablyRace(a)).length;
  const recentRaceCount14 = activities.filter(a => a.date >= cutoff14 && a.date <= todayISO && isProbablyRace(a)).length;
  const marathonInLast14 = activities.some(a => a.date >= cutoff14 && a.date <= todayISO && isProbablyRace(a) && a.distanceMi >= 22);
  const heavyBlockSuspected = recentRaceCount21 >= 3
    || recentRaceCount14 >= 2
    || marathonInLast14
    || (weeklyAvg8w > 0 && recent4.some(w => w.miles >= weeklyAvg8w * 1.5));
  const rebuildAfterBreak = last28Mi > 0 && last7Mi <= last28Mi / 4 * 0.30;

  // Compute the latest recovery-window-end across all recent races
  // (saved + Strava-detected). A marathon contributes 26 days, a half
  // 14, a 10K 7, a 5K 3. The runner stays in POST_RACE phase until
  // every window has closed.
  const allRecentRaces: Array<{ date: string; distanceMi: number }> = [
    ...recent.map(r => ({ date: r.date, distanceMi: r.distanceMi })),
  ];
  let recoveryWindowEndsISO: string | null = null;
  for (const r of allRecentRaces) {
    const days = recoveryDaysForDistance(r.distanceMi);
    const raceDay = new Date(r.date + 'T12:00:00Z');
    raceDay.setUTCDate(raceDay.getUTCDate() + days);
    const endISO = raceDay.toISOString().slice(0, 10);
    if (endISO < todayISO) continue;            // window already closed
    if (recoveryWindowEndsISO == null || endISO > recoveryWindowEndsISO) {
      recoveryWindowEndsISO = endISO;
    }
  }

  // Runner profile (Postgres-backed, server-side). Failure is non-
  // fatal — empty profile is valid, downstream just falls back to
  // defaults (HARD_EFFORT_HR_DEFAULT_BPM, no age-graded VDOT, etc).
  const runnerProfile = await (async () => {
    try {
      const { getRunnerProfile, ageFromBirthDate, resolveHrmax } = await import('./runner-profile-store');
      const p = await getRunnerProfile();
      const age = ageFromBirthDate(p.birthDate, today);
      const hrmaxResolved = resolveHrmax(p);
      return {
        age,
        sex: p.sex,
        hrmaxBpm: p.hrmaxBpm,
        rhrBpm: p.rhrBpm,
        resolvedHrmaxBpm: hrmaxResolved?.bpm ?? null,
        longRunDow: p.longRunDow,
      };
    } catch {
      return { age: null, sex: 'unspecified' as const, hrmaxBpm: null, rhrBpm: null, resolvedHrmaxBpm: null, longRunDow: null };
    }
  })();

  // Recent RPE (post-workout perceived effort) — Research/00b
  // §INCOMPLETE_RECOVERY_QUALITATIVE_SIGNALS. We compute the 7d-vs-prior-7d
  // drift here so the engine doesn't have to walk the array. Drift
  // signal threshold: ≥1 point bump means perceived load is creeping
  // up vs prior week, which often precedes overreaching by 1-2 weeks.
  const rpeState = await (async () => {
    try {
      const { getRecentRpe } = await import('./rpe-store');
      const recent = await getRecentRpe(14);
      const todayDate = new Date(todayISO + 'T12:00:00Z');
      const cutoff7 = new Date(todayDate); cutoff7.setUTCDate(cutoff7.getUTCDate() - 7);
      const cutoff14 = new Date(todayDate); cutoff14.setUTCDate(cutoff14.getUTCDate() - 14);
      const cutoff7ISO = cutoff7.toISOString().slice(0, 10);
      const cutoff14ISO = cutoff14.toISOString().slice(0, 10);
      const last7 = recent.filter(e => e.workoutDate >= cutoff7ISO);
      const prior7 = recent.filter(e => e.workoutDate >= cutoff14ISO && e.workoutDate < cutoff7ISO);
      const avg = (xs: number[]) => xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
      const avg7d = avg(last7.map(e => e.rpe));
      const avgPrior7d = avg(prior7.map(e => e.rpe));
      const drift = (avg7d != null && avgPrior7d != null) ? avg7d - avgPrior7d : null;
      // recentHeavy: any of the last 3 days has rpe >= 8.
      const cutoff3 = new Date(todayDate); cutoff3.setUTCDate(cutoff3.getUTCDate() - 3);
      const cutoff3ISO = cutoff3.toISOString().slice(0, 10);
      const recentHeavy = recent.some(e => e.workoutDate >= cutoff3ISO && e.rpe >= 8);
      return {
        recent: recent.map(e => ({ workoutDate: e.workoutDate, rpe: e.rpe, notes: e.notes })),
        avg7d,
        avgPrior7d,
        drift,
        recentHeavy,
      };
    } catch {
      return {
        recent: [] as Array<{ workoutDate: string; rpe: number; notes: string | null }>,
        avg7d: null,
        avgPrior7d: null,
        drift: null,
        recentHeavy: false,
      };
    }
  })();

  return {
    now: todayISO,
    races: {
      nextA, nextAny, inWindow, recent, racesForVdot, raceCount30d,
    },
    runner: runnerProfile,
    volume: {
      last7Mi, last28Mi, last7Days,
      weeklyAvg4w, weeklyAvg8w,
      longestLast28Mi, deltaPct4v4,
    },
    intensity: {
      easyMi14d: balance.easyMi,
      hardMi14d: balance.hardMi,
      easyShare14d: balance.easyShare,
    },
    recovery: {
      daysSinceLastRun: Number.isFinite(daysSinceLastRun) ? daysSinceLastRun : -1,
      consecutiveRunDays,
      yesterday: yesterdayRun ? {
        distMi: yesterdayRun.distanceMi,
        paceSPerMi: yesterdayRun.paceSPerMi,
        avgHr: yesterdayRun.avgHr,
        name: yesterdayRun.name,
        activityId: yesterdayRun.id,
      } : null,
      today: todayRun ? {
        distMi: todayRun.distanceMi,
        paceSPerMi: todayRun.paceSPerMi,
        avgHr: todayRun.avgHr,
        name: todayRun.name,
        activityId: todayRun.id,
      } : null,
      hrv7dAvgMs: null,
      rhrBpm: null,
      sleep7dAvgHrs: null,
      strengthDaysThisWeek: null,
    },
    rpe: rpeState,
    flags: {
      heavyBlockSuspected,
      rebuildAfterBreak,
      healthKitAvailable: false,
    },
    recoveryWindowEndsISO,
  };
}

/** Distance-driven recovery duration. Reads from the canonical
 *  doctrine table (Research/00b §Post-Race Recovery › Recovery by
 *  Distance) — the high end of "no quality" days for each distance
 *  band. The band mapping itself lives in lib/recovery-distance.ts
 *  (a pure module with no DB imports) so client code can reuse it
 *  without dragging Postgres into the browser bundle. */
function recoveryDaysForDistance(distMi: number): number {
  const band = postRaceDistanceBand(distMi);
  return POST_RACE_BY_DISTANCE.value[band].totalRecoveryDaysNoQualityHigh;
}

function toNextRace(r: SavedRace): NextRace {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(r.meta.date + 'T12:00:00Z');
  const daysAway = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  const goalFinishS = parseGoalHMS(r.meta.goalDisplay);
  const goalPaceSPerMi = goalFinishS != null && r.meta.distanceMi > 0
    ? Math.round(goalFinishS / r.meta.distanceMi)
    : null;
  return {
    slug: r.slug,
    name: r.meta.name,
    date: r.meta.date,
    distanceMi: r.meta.distanceMi,
    goalDisplay: r.meta.goalDisplay,
    goalFinishS,
    goalPaceSPerMi,
    priority: r.meta.priority ?? 'A',
    daysAway,
  };
}

function isoDateOffset(base: Date, days: number): string {
  const d = new Date(base); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 86_400_000);
}
function round1(n: number): number { return Math.round(n * 10) / 10; }
