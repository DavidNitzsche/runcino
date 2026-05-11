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
    /** Races finished in the last 28 days, newest first. */
    recent: PastRace[];
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

export async function gatherCoachState(): Promise<CoachState> {
  // "Today" in LA — server runs in UTC and would otherwise flip a day
  // early in the evening. todayDate() is anchored at noon UTC of the
  // LA calendar date so isoDateOffset's setDate/getDate math is safe.
  const today = todayDate();
  const todayISO = todayLAISO();

  const [savedRaces, { activities }] = await Promise.all([
    // Gracefully degrade when DATABASE_URL is unset (local dev without Postgres)
    // or when the races table is empty. The Coach state still computes from
    // whatever data is available — empty races just means no A/B race surfaces.
    listRacesDB().catch(() => [] as Awaited<ReturnType<typeof listRacesDB>>),
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

  return {
    now: todayISO,
    races: {
      nextA, nextAny, inWindow, recent, raceCount30d,
    },
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
    flags: {
      heavyBlockSuspected,
      rebuildAfterBreak,
      healthKitAvailable: false,
    },
    recoveryWindowEndsISO,
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
