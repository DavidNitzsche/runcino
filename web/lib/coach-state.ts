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
 *   - user_prefs               → per-runner weekly cadence (long/quality/rest days)
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
import { gatherCheckinAggregate, type CheckinAggregate } from './checkin-aggregate';
import { getUserPrefs, type PrefsRow } from './prefs-store';
import { listRecentSkips, type SkippedWorkout } from './skip-store';
import type { NormalizedActivity } from '../app/api/strava/activities/route-shared';
import type { SavedRace } from './storage-types';

export interface CoachState {
  /** ISO date the state was gathered. Engine should treat this as "today". */
  now: string;

  /** Pre-resolved aggregate VDOT — when populated, vdotSnapshot and
   *  paceTargetFromVdot prefer this over the single-best-race picker.
   *  Aligns engine pace decisions with what the user sees on
   *  /profile's Coach Reads card (computeAggregateVdot in
   *  lib/compute-vdot.ts is the source). Optional for backwards-
   *  compat with test fixtures that don't supply it. */
  aggregateVdotValue?: number;

  /** Race calendar — calendar-aware decisions cascade off here. */
  races: {
    /** Next A race in the future (closest by date). null = base mode candidate. */
    nextA: NextRace | null;
    /** Next race of any priority (A/B/C). May equal nextA. */
    nextAny: NextRace | null;
    /** Every race in the future within a distance-aware build window from today. */
    inWindow: NextRace[];
    /** Races finished in the last 28 days, newest first. */
    recent: PastRace[];
    /** Best race performances within the last 180 days — used for VDOT
     *  inference. Wider window catches fast efforts that predate a recovery
     *  or maintenance block. Optional for backwards compat with test fixtures. */
    bestForVdot?: PastRace[];
    /** Number of races (any priority) finished in the last 30 days. Heavy-block signal. */
    raceCount30d: number;
  };

  /** Volume signals — pulled from Strava activities. */
  volume: {
    last7Mi: number;
    last28Mi: number;
    /** Daily totals for the CURRENT calendar week (Mon → Sun in LA tz),
     *  including future days (miles=0). Built via `currentWeekDays`.
     *
     *  ⚠ Despite the name, this is NOT a sliding 7-day window — it's
     *  the user's Mon-Sun work week. Consumers that want a true rolling
     *  7-day rollup must either (a) sum activities directly, or (b)
     *  fall back to `last7Mi` (which IS the rolling sum). Matching
     *  planned dates from `simulateRange(today-6, today)` against this
     *  array silently fails for any planned date that falls in last
     *  week — those dates are not in the map. */
    last7Days: Array<{ date: string; miles: number; runs: number }>;
    weeklyAvg4w: number;
    weeklyAvg8w: number;
    /** Longest single activity in last 28 days — INCLUDES races. NEVER
     *  use as +10% spike baseline. Use `longestTrainingRunLast28Mi`. */
    longestLast28Mi: number;
    /** Longest TRAINING run in last 28 days — races excluded. Anchor
     *  for the +10% spike rule. @research Research/00a §13.1 */
    longestTrainingRunLast28Mi: number;
    /** Longest TRAINING run in 28 days BEFORE the most recent race.
     *  Anchors post-race long-run ramp at ~50%. Null when no recent
     *  race / no pre-race training. @research Research/00b §Recovery
     *  by Effort */
    preRaceLongestTrainingMi: number | null;
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
    /** Runner-initiated skips in the last 14 days. Each row is one
     *  explicit Skip Today click. Empty when no skips. Engine treats
     *  this as ground truth, not a fuzzy signal — the runner said
     *  "today didn't happen." adaptPlan fires a `runner-skip` trigger
     *  when a skip lands on a planned quality day. */
    recentSkips: Array<{
      dateISO: string;
      plannedWorkoutType: string | null;
      plannedMi: number | null;
    }>;
  };

  /** 7-day daily_checkin rollup (energy / soreness / stress, each 1-10).
   *  Null when no rows in the window — the engine treats it as a
   *  missing signal, not zeroed-out.
   *
   *  @research Research/00b §Warning Signs of Incomplete Recovery —
   *            Qualitative Signals · Decision Matrix */
  checkin: CheckinAggregate | null;

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

  /** Raw activity list — surfaced for plan adaptation triggers that need
   *  per-run execution signals (e.g., quality session pace scoring).
   *  Optional for backwards compat with test fixtures. */
  activities?: NormalizedActivity[];

  /** User-configured weekly cadence parsed from the `user_prefs` table.
   *  Every day-of-week comparison in the engine reads from this block —
   *  hardcoded weekdays in the engine encoded `isDefaults: true` behavior
   *  and ignored what the user actually wanted.
   *
   *  Days are JS `Date.getDay()` integers: 0=Sun, 1=Mon, ..., 6=Sat.
   *
   *  Defaults (when no row exists OR a field is null/garbage):
   *    longRunDow: 6 (Saturday) — runner-standard default
   *    qualityDows: [2, 4] (Tue / Thu)
   *    restDow: 1 (Monday)
   *
   *  Saturday — not Sunday — is the long-run default. Most adult runners
   *  with Mon-Fri jobs run their long on Saturday so Sunday is open for
   *  recovery + the rest of life; coaching doctrine (Pfitzinger, Daniels,
   *  Hudson) all default to Saturday in their published plans. */
  prefs: {
    longRunDow: number;
    qualityDows: number[];
    /** null means "engine decides" — engine derives the rest day
     *  relative to the long run when this is null. */
    restDow: number | null;
    /** Explicit level set by the user in their profile. null = auto-detect
     *  from weeklyAvg4w at plan-authoring time. When set, overrides the
     *  auto-detect and drives the plan-template lookup directly. */
    level: 'beginner' | 'intermediate' | 'advanced' | null;
    /** True when no user_prefs row existed (or every parsed field fell
     *  back to a default). Lets the UI surface "Using defaults — set
     *  yours" without re-querying. */
    isDefaults: boolean;
  };
}

interface NextRace {
  slug: string;
  name: string;
  date: string;
  distanceMi: number;
  goalDisplay: string;
  goalFinishS: number | null;
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

/** Options for gatherCoachState — opaque struct so we can add fields
 *  without breaking call sites. When `userId` is passed, the aggregate
 *  VDOT is pre-loaded into state.aggregateVdotValue so the engine's
 *  pace decisions match what /profile shows. */
export interface GatherCoachStateOpts {
  userId?: string;
}

export async function gatherCoachState(opts: GatherCoachStateOpts = {}): Promise<CoachState> {
  // "Today" in LA — server runs in UTC and would otherwise flip a day
  // early in the evening. todayDate() is anchored at noon UTC of the
  // LA calendar date so isoDateOffset's setDate/getDate math is safe.
  const today = todayDate();
  const todayISO = todayLAISO();

  const [savedRaces, { activities }, checkinAgg, prefsRow, recentSkipsRaw] = await Promise.all([
    // Gracefully degrade when DATABASE_URL is unset (local dev without Postgres)
    // or when the races table is empty. The Coach state still computes from
    // whatever data is available — empty races just means no A/B race surfaces.
    // When userId is provided, races scoped to that user (legacy rows with
    // null user_uuid stay visible for now — additive migration).
    listRacesDB(opts.userId).catch(() => [] as Awaited<ReturnType<typeof listRacesDB>>),
    getCachedActivities(opts.userId).catch(() => ({ activities: [] as NormalizedActivity[], fetchedAt: 0 })),
    // gatherCheckinAggregate swallows DB failures internally so this
    // resolves to a 0-rows aggregate when Postgres is unavailable.
    gatherCheckinAggregate(todayISO),
    // Prefs are optional — when the user_prefs table is unreachable or
    // has no row, parsePrefsRow(null) returns the engine-wide defaults.
    // Prefs are user-scoped via user_id text (legacy 'me' for single-
    // tenant rows). prefs-store accepts a string user_id; passing the
    // resolved userId when available, otherwise falls back to 'me' so
    // existing single-tenant data still reads.
    getUserPrefs(opts.userId ?? 'me').catch(() => null),
    // Skips are optional — empty list when the table is unreachable or
    // when the runner hasn't ever clicked Skip Today.
    listRecentSkips({ sinceISO: isoDateOffset(today, -14) }).catch(
      () => [] as SkippedWorkout[],
    ),
  ]);

  // Null `state.checkin` means "no rows in the last 7 days" — the
  // engine treats it as a missing signal, not zeroed-out.
  const checkin: CheckinAggregate | null = checkinAgg.rowsCount > 0 ? checkinAgg : null;

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

  // VDOT source: best performances within 180 days. Wider window catches
  // peak fitness from a completed build even when currently in recovery.
  // Excludes marathon+ (late-race fatigue confounds VDOT inference).
  const cutoff180 = isoDateOffset(today, -180);
  const vdotSaved = savedRaces
    .filter(r => r.meta.date >= cutoff180 && r.meta.date <= todayISO && r.actualResult && r.meta.distanceMi < 22)
    .map<PastRace>(r => ({
      slug: r.slug, activityId: r.actualResult?.stravaActivityId ?? null,
      name: r.meta.name, date: r.meta.date, distanceMi: r.meta.distanceMi,
      finishS: r.actualResult?.finishS ?? null,
      daysAgo: daysBetween(r.meta.date, todayISO),
    }));
  const vdotSavedActIds = new Set(vdotSaved.map(r => r.activityId).filter((id): id is number => id != null));
  const vdotStrava = activities
    .filter(a => a.date >= cutoff180 && a.date <= todayISO && isProbablyRace(a) && a.distanceMi < 22 && !vdotSavedActIds.has(a.id))
    .map<PastRace>(a => ({
      slug: null, activityId: a.id,
      name: a.name, date: a.date, distanceMi: a.distanceMi,
      finishS: a.movingTimeS,
      daysAgo: daysBetween(a.date, todayISO),
    }));
  const bestForVdot = [...vdotSaved, ...vdotStrava]
    .filter(r => r.finishS != null)
    .sort((a, b) => b.date.localeCompare(a.date));
  // vdotSnapshot picks the highest VDOT; training best efforts added below
  // (after isRaceActivity is defined)

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
  const longestLast28Mi = last28.length > 0 ? round1(Math.max(...last28.map(a => a.distanceMi))) : 0;

  // Training-only longest — excludes races. Detection unions Strava
  // workout_type/isProbablyRace name pattern with the user's `races`
  // table. Safe baseline for the +10% single-session spike rule.
  const savedRaceDates = new Set(savedRaces.map(r => r.meta.date));
  const isRaceActivity = (a: NormalizedActivity): boolean =>
    isProbablyRace(a) || savedRaceDates.has(a.date);

  // Training runs where Strava computed a canonical best effort (fastest
  // segment at 1 mi / 5K / 10K / 15K / HM inside ANY run). These land on
  // NormalizedActivity.canonicalFinishS when activity detail has been fetched
  // (the /api/strava/bests lazy-fetcher caches detail on demand). A fast 5K
  // best effort pulled out of a tempo run is real VDOT data.
  // Marathon+ excluded (fatigue confounds inference, same rule as races above).
  const trainingWithBests = activities
    .filter(a =>
      a.date >= cutoff180 &&
      a.date <= todayISO &&
      !isRaceActivity(a) &&
      a.canonicalFinishS != null &&
      (a.canonicalDistanceMi ?? 0) > 0 &&
      (a.canonicalDistanceMi ?? 0) < 22,
    )
    .map<PastRace>(a => ({
      slug: null,
      activityId: a.id,
      name: `${a.name} (best effort)`,
      date: a.date,
      distanceMi: a.canonicalDistanceMi!,
      finishS: a.canonicalFinishS,
      daysAgo: daysBetween(a.date, todayISO),
    }));
  bestForVdot.push(...trainingWithBests.filter(r => r.finishS != null));

  const last28Training = last28.filter(a => !isRaceActivity(a));
  const longestTrainingRunLast28Mi = last28Training.length > 0
    ? round1(Math.max(...last28Training.map(a => a.distanceMi)))
    : 0;

  // Pre-race longest training run: anchors post-race long-run ramp at
  // ~50% of pre-race long. Research/00b §Recovery by Effort.
  let preRaceLongestTrainingMi: number | null = null;
  const mostRecentRace = recent[0];
  if (mostRecentRace) {
    const preRaceStart = isoDateOffset(new Date(mostRecentRace.date + 'T12:00:00Z'), -28);
    const preRaceTraining = activities.filter(a =>
      a.date >= preRaceStart && a.date < mostRecentRace.date && !isRaceActivity(a)
    );
    if (preRaceTraining.length > 0) {
      preRaceLongestTrainingMi = round1(Math.max(...preRaceTraining.map(a => a.distanceMi)));
    }
  }

  // ── Intensity ─────────────────────────────────────────────
  const balance = effortBalance(activities, 14);

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

  // Pre-load the aggregate VDOT when a userId is provided. This is
  // the SAME value /profile's Coach Reads card shows; threading it
  // into state.aggregateVdotValue means vdotSnapshot + paceTargetFromVdot
  // pick the same number the UI displays.
  let aggregateVdotValue: number | undefined;
  if (opts.userId) {
    try {
      const { computeAggregateVdot } = await import('./compute-vdot');
      const agg = await computeAggregateVdot(opts.userId);
      if (agg && agg.value > 0) aggregateVdotValue = agg.value;
    } catch {
      // Aggregate VDOT is an optimization; engine falls back to
      // single-best-race picker if the lookup fails.
    }
  }

  return {
    now: todayISO,
    aggregateVdotValue,
    races: {
      nextA, nextAny, inWindow, recent, raceCount30d, bestForVdot,
    },
    volume: {
      last7Mi, last28Mi, last7Days,
      weeklyAvg4w, weeklyAvg8w,
      longestLast28Mi, longestTrainingRunLast28Mi, preRaceLongestTrainingMi,
      deltaPct4v4,
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
    flags: {
      heavyBlockSuspected,
      rebuildAfterBreak,
      healthKitAvailable: false,
      recentSkips: recentSkipsRaw.map((s) => ({
        dateISO: s.dateISO,
        plannedWorkoutType: s.plannedWorkoutType,
        plannedMi: s.plannedMi,
      })),
    },
    activities,
    checkin,
    recoveryWindowEndsISO,
    prefs: parsePrefsRow(prefsRow),
  };
}

/** Distance-driven recovery duration. Doc §13.3 + the legacy
 *  "1 day per mile" guideline. Floor 3 days, cap 28 days. */
function recoveryDaysForDistance(distMi: number): number {
  if (distMi >= 22) return 26;   // marathon
  if (distMi >= 11) return 14;   // half
  if (distMi >= 5)  return 7;    // 10K
  return 3;                       // 5K-ish
}

// ─────────────────────────────────────────────────────────────────
// User-preference parsing
// The `user_prefs` table stores days as free-form strings: "Saturday",
// "Sat", "SAT" all mean dow=6. Quality days arrive as "Tue / Thu" (slash
// + spaces) or sometimes "Tue, Thu". Tolerant parsing — fall back to
// defaults on anything we can't decode rather than throwing.
// ─────────────────────────────────────────────────────────────────

/** Default cadence applied when no `user_prefs` row exists OR when an
 *  individual field is null/garbage. Saturday long run, Tue/Thu quality,
 *  Monday rest is the runner-standard default in every major coaching
 *  manual (Pfitzinger, Daniels, Hudson). */
export const DEFAULT_LONG_RUN_DOW = 6;        // Saturday
export const DEFAULT_QUALITY_DOWS = [2, 4];   // Tue / Thu
export const DEFAULT_REST_DOW = 1;            // Monday

/** Parse one day-name string into a JS `getDay()` integer.
 *  Returns null when the string can't be decoded — caller falls back
 *  to a default and (optionally) logs a warning. */
export function parseDayName(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const MAP: Record<string, number> = {
    sun: 0, sunday: 0,
    mon: 1, monday: 1,
    tue: 2, tues: 2, tuesday: 2,
    wed: 3, weds: 3, wednesday: 3,
    thu: 4, thur: 4, thurs: 4, thursday: 4,
    fri: 5, friday: 5,
    sat: 6, saturday: 6,
  };
  if (s in MAP) return MAP[s];
  // Try a 3-char prefix as last resort: handles "Saturdays", "MONDAYS",
  // ".sat", etc.
  const head = s.slice(0, 3);
  if (head in MAP) return MAP[head];
  return null;
}

/** Coerce a value into a JS getDay() int, or null if invalid. */
function isValidDow(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 6;
}

/** Parse a comma-separated list of dow ints ("2,4") into a sorted
 *  dedup list. Tolerant — invalid entries are dropped. */
function parseIntList(raw: string | null | undefined): number[] {
  if (!raw) return [];
  const out = new Set<number>();
  for (const p of raw.split(/[,\s/]+/).map(s => s.trim()).filter(Boolean)) {
    const n = Number(p);
    if (Number.isInteger(n) && n >= 0 && n <= 6) out.add(n);
  }
  return Array.from(out).sort((a, b) => a - b);
}

/** Parse a comma/slash-separated combo string ("Tue / Thu", "Wed, Sat")
 *  into a sorted dedup list of dows. Empty/garbage returns []. */
export function parseDayCombo(raw: string | null | undefined): number[] {
  if (!raw) return [];
  const parts = raw.split(/[,/]/).map(p => p.trim()).filter(Boolean);
  const out = new Set<number>();
  for (const p of parts) {
    const d = parseDayName(p);
    if (d != null) out.add(d);
  }
  return Array.from(out).sort((a, b) => a - b);
}

/** Translate a `user_prefs` row (or null = no row) into the engine's
 *  `prefs` block. Tolerant — every field individually falls back to a
 *  default. `isDefaults` is true only when nothing custom survived. */
export function parsePrefsRow(row: PrefsRow | null): CoachState['prefs'] {
  if (!row) {
    return {
      longRunDow: DEFAULT_LONG_RUN_DOW,
      qualityDows: DEFAULT_QUALITY_DOWS.slice(),
      restDow: DEFAULT_REST_DOW,
      level: null,
      isDefaults: true,
    };
  }
  // Prefer the new int columns set by the EditProfileModal. Fall back
  // to parsing the legacy day-name strings when ints aren't set.
  const longParsed = isValidDow(row.long_run_dow) ? row.long_run_dow : parseDayName(row.long_run_day);
  const qualityFromInt = parseIntList(row.quality_dows);
  const qualityParsed = qualityFromInt.length > 0 ? qualityFromInt : parseDayCombo(row.quality_days);
  const restParsed = isValidDow(row.rest_dow) ? row.rest_dow : parseDayName(row.rest_day);

  // Warn on unparseable input so DB rot is visible in logs — don't
  // throw, fall back silently in production-ish behavior.
  if (row.long_run_day && longParsed == null) {
    console.warn(`[coach-state] Could not parse user_prefs.long_run_day=${JSON.stringify(row.long_run_day)} — using default Saturday`);
  }
  if (row.quality_days && qualityParsed.length === 0) {
    console.warn(`[coach-state] Could not parse user_prefs.quality_days=${JSON.stringify(row.quality_days)} — using default [Tue, Thu]`);
  }
  if (row.rest_day && restParsed == null) {
    console.warn(`[coach-state] Could not parse user_prefs.rest_day=${JSON.stringify(row.rest_day)} — using default Monday`);
  }

  const longRunDow = longParsed ?? DEFAULT_LONG_RUN_DOW;
  const qualityDows = qualityParsed.length > 0 ? qualityParsed : DEFAULT_QUALITY_DOWS.slice();
  const restDow = restParsed ?? DEFAULT_REST_DOW;
  const level = row.level ?? null;

  // isDefaults: every parsed field landed on its default. A row may
  // exist but be all-null — that still counts as defaults from the
  // engine's perspective.
  const isDefaults =
    longParsed == null &&
    qualityParsed.length === 0 &&
    restParsed == null &&
    level == null;

  return { longRunDow, qualityDows, restDow, level, isDefaults };
}

function toNextRace(r: SavedRace): NextRace {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(r.meta.date + 'T12:00:00Z');
  const daysAway = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  return {
    slug: r.slug,
    name: r.meta.name,
    date: r.meta.date,
    distanceMi: r.meta.distanceMi,
    goalDisplay: r.meta.goalDisplay,
    goalFinishS: parseGoalHMS(r.meta.goalDisplay),
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
