/**
 * Event-driven CoachState fixtures (Wave K) — what the coach does when
 * *something happens mid-cycle*. The 7 archetypes in coach-states.ts
 * cover positions in a training cycle (post-race / build / peak / etc.);
 * this file covers the disruptions that actually test whether adaptive
 * coaching earns its keep.
 *
 * Each fixture sets up a runner just before a triggering event. The
 * partner test file (coach-engine-events) simulates the engine's
 * response and asserts the plan adapts.
 *
 * Conventions match coach-states.ts:
 *   - Dates use ISO `YYYY-MM-DD` generated from `dayOffsetISO`.
 *   - `state.now` is always today.
 *   - Each fixture isolates ONE event class so a future regression
 *     points at the exact adaptive-path that broke.
 *
 * Type strategy:
 *   - We re-export the canonical CoachState type from web/lib/coach-state.
 *   - For the daily-checkin aggregate (state.checkin) we reference the
 *     CheckinAggregate shape from web/lib/checkin-aggregate and attach
 *     it as a structural augmentation — that field is in-flight (Wave F)
 *     and currently optional on the runtime path that reads it
 *     (`input.state.checkin?.poorDaysCount`). When the type formally
 *     lands we'll drop the `as CoachState` cast.
 *
 * Research grounding:
 *   - Research/00b §Warning Signs of Incomplete Recovery — qualitative
 *     count → Decision Matrix (drives K1, K2, K6, K9).
 *   - Research/05 §1.4-1.5 — "volume before intensity"; rebuild after
 *     break; weeks-off ≈ weeks-to-rebuild-base (K3, K8, K9).
 *   - Research/02 §2 Riegel + Research/01 §VDOT calibration windows
 *     (K4, K5, K10).
 *   - Research/00b §Recovery by Distance (K7's race-stacking caveat).
 */
import type { CoachState } from '../../coach-state';
import type { CheckinAggregate } from '../../checkin-aggregate';

// CoachState.checkin is required (Wave F). Every fixture in this file
// sets it explicitly — null when the runner has no recent rows,
// populated when the event fixture leans on the check-in signal.
type CoachStateWithCheckin = CoachState;

/** ISO date `dayOffset` days from today (anchored at noon UTC of the
 *  local date so setDate/getDate math is timezone-safe). Mirrors the
 *  helper in fixtures/coach-states.ts so this module stays self-
 *  contained if coach-states.ts lands separately.
 *
 *  When fixtures/coach-states.ts is on the same branch, the two
 *  copies render identical values for any given offset. */
export function dayOffsetISO(daysFromToday: number, anchor: Date = new Date()): string {
  const base = new Date(Date.UTC(
    anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 12, 0, 0,
  ));
  base.setUTCDate(base.getUTCDate() + daysFromToday);
  return base.toISOString().slice(0, 10);
}

export const TODAY_ISO = dayOffsetISO(0);

// ─────────────────────────────────────────────────────────────────
// Shared scaffolding — mid-build runner baseline shared across K1, K2,
// K3, K6. Mirrors STATE_MID_BUILD_WEEK_4 (30 mpw, 10w to A-half).
// Each event fixture derives from this so the only delta vs the baseline
// is the triggering signal — failures point at the adaptive path.
// ─────────────────────────────────────────────────────────────────
/** Exported variant of the mid-build baseline so partner tests can use
 *  it as the apples-to-apples comparison point (e.g. "with bad checkins
 *  vs without"). Equivalent in shape to STATE_MID_BUILD_WEEK_4 from
 *  coach-states.ts; lives here so this module stays self-contained. */
export const STATE_MID_BUILD_BASE: CoachStateWithCheckin = buildMidBuildBaseInternal();

function buildMidBuildBase(): CoachState {
  return buildMidBuildBaseInternal();
}

function buildMidBuildBaseInternal(): CoachState {
  const nextA = {
    slug: 'autumn-half-2026',
    name: 'Autumn Half',
    date: dayOffsetISO(10 * 7),
    distanceMi: 13.1,
    goalDisplay: '1:35',
    goalFinishS: 5700,
    priority: 'A' as const,
    daysAway: 10 * 7,
  };
  return {
    now: TODAY_ISO,
    races: {
      nextA, nextAny: nextA,
      inWindow: [nextA], recent: [], raceCount30d: 0,
    },
    volume: {
      last7Mi: 30, last28Mi: 124, last7Days: [],
      weeklyAvg4w: 31, weeklyAvg8w: 28,
      longestLast28Mi: 11,
      longestTrainingRunLast28Mi: 11,
      preRaceLongestTrainingMi: null,
      deltaPct4v4: 0.12,
    },
    intensity: { easyMi14d: 45, hardMi14d: 16, easyShare14d: 0.74 },
    recovery: {
      daysSinceLastRun: 1, consecutiveRunDays: 4,
      yesterday: { distMi: 5, paceSPerMi: 510, avgHr: 142, name: 'Easy 5', activityId: 11 },
      today: null,
      hrv7dAvgMs: null, rhrBpm: null, sleep7dAvgHrs: null, strengthDaysThisWeek: null,
    },
    flags: { heavyBlockSuspected: false, rebuildAfterBreak: false, healthKitAvailable: false, recentSkips: [] },
    checkin: null,
    recoveryWindowEndsISO: null,
    prefs: {
      longRunDow: 6, qualityDows: [2, 4], restDow: 1, level: null, isDefaults: true,
    },
  };
}

/** Empty 7-day aggregate stand-in; partial-aware fixtures override
 *  `poorDaysCount` and `avgEnergy`/`avgSoreness`. */
function emptyCheckin(): CheckinAggregate {
  return {
    windowDays: 7, rowsCount: 0,
    avgEnergy: null, avgSoreness: null, avgStress: null,
    poorDaysCount: 0, latestDateISO: null, loggedToday: false,
  };
}

// ─────────────────────────────────────────────────────────────────
// K1 — Bad single check-in mid-build.
//   Yesterday's check-in: sleep ~4h proxied via low energy, soreness
//   8/10, mood proxy = low energy too. poorDaysCount = 1 (just yesterday).
//   Assertion: Coach is aware via state.checkin even at count=1 — but
//   doctrine (Research/00b §Decision Matrix) only triggers the adaptive
//   ladder at count≥2. K1 documents the count=1 case so K2 (count≥2)
//   has a clean comparison point.
// ─────────────────────────────────────────────────────────────────
export const STATE_BAD_CHECKIN_TODAY: CoachStateWithCheckin = (() => {
  const base = buildMidBuildBase();
  const checkin: CheckinAggregate = {
    ...emptyCheckin(),
    rowsCount: 1,
    avgEnergy: 3, avgSoreness: 8, avgStress: 7,
    poorDaysCount: 1,
    latestDateISO: dayOffsetISO(-1),
    loggedToday: false,
  };
  return { ...base, checkin };
})();

// ─────────────────────────────────────────────────────────────────
// K2 — Bad WEEK of check-ins mid-build.
//   Last 7 check-ins all "poor" (energy ≤4 OR soreness ≥7 OR stress ≥7).
//   poorDaysCount = 7 — well past the Decision-Matrix cutback threshold
//   (3+ signals → 50% cutback). Recovery also reflects: yesterday's run
//   was hard (avgHr above the HARD_EFFORT default), and easyShare14d is
//   under the build-phase target (0.70 vs 0.80 target) — so multiple
//   signals are firing in concert with the qualitative count.
// ─────────────────────────────────────────────────────────────────
export const STATE_BAD_WEEK_CHECKINS: CoachStateWithCheckin = (() => {
  const base = buildMidBuildBase();
  const checkin: CheckinAggregate = {
    ...emptyCheckin(),
    rowsCount: 7,
    avgEnergy: 3, avgSoreness: 8, avgStress: 6,
    poorDaysCount: 7,
    latestDateISO: dayOffsetISO(0),
    loggedToday: true,
  };
  return {
    ...base,
    intensity: { easyMi14d: 38, hardMi14d: 18, easyShare14d: 0.68 },
    checkin,
  };
})();

// ─────────────────────────────────────────────────────────────────
// K3 — Three skipped runs in a row mid-build.
//   Same build baseline, but last7Mi cratered (12 instead of 30 — the
//   3 missed runs removed ~18mi). weeklyAvg4w stays at 31 (the prior
//   weeks are unaffected). deltaPct4v4 negative — the engine should
//   read the volume gap, not paper over it. recovery.daysSinceLastRun
//   = 3 + last7Days reflects the gap days.
// ─────────────────────────────────────────────────────────────────
export const STATE_THREE_SKIPPED_RUNS: CoachState = (() => {
  const base = buildMidBuildBase();
  // Build a last7Days that shows the 3 missed days. Indices 0..6 oldest
  // → today; oldest 4 days have runs, last 3 are 0.
  const last7Days = [-6, -5, -4, -3, -2, -1, 0].map((off, i) => ({
    date: dayOffsetISO(off),
    miles: i < 4 ? 4 : 0,
    runs: i < 4 ? 1 : 0,
  }));
  return {
    ...base,
    volume: {
      ...base.volume,
      last7Mi: 16,            // 4×4mi runs in the first 4 days, 0 after
      last28Mi: 95,           // prior 21d unaffected (~26mpw × 3 + 16)
      last7Days,
      weeklyAvg4w: 25,        // mildly dragged down
      weeklyAvg8w: 26,
      deltaPct4v4: -0.35,
    },
    intensity: { easyMi14d: 30, hardMi14d: 10, easyShare14d: 0.75 },
    recovery: {
      ...base.recovery,
      daysSinceLastRun: 3,    // 3 days no runs
      consecutiveRunDays: 0,
      yesterday: null,
    },
  };
})();

// ─────────────────────────────────────────────────────────────────
// K4 — Bad B-race result (raced ~30s/mi slower than VDOT predicted).
//   Runner has a prior 5K (12 weeks ago) that pegged VDOT ~49 (20:00).
//   B-race was a 10K 2 days ago — VDOT 49 predicts ~41:35 (~6:42/mi).
//   Actual 7:12/mi = 44:43 (~30 s/mi slow). Engine should flag this
//   in retrospect + soften the next 14 days.
//
//   Implementation note: vdotSnapshot picks the STRONGEST recent race
//   by computed VDOT. With both 5K and 10K present in `recent`, the
//   slow 10K computes to a lower VDOT and gets dropped — so vdotSnapshot
//   will still return the 5K's VDOT. That's actually the bug we're
//   testing for K4: retrospect needs to ALSO read state.races.recent
//   for "what just happened" vs vdotSnapshot's "current fitness signal".
// ─────────────────────────────────────────────────────────────────
export const STATE_BAD_B_RACE_RESULT: CoachState = (() => {
  const base = buildMidBuildBase();
  // Prior 5K — strong, 20:00 → VDOT ≈ 49
  const prior5k = {
    slug: 'spring-5k', activityId: 100, name: 'Spring 5K',
    date: dayOffsetISO(-26),  // inside the 28d recent window
    distanceMi: 3.1, finishS: 1200, daysAgo: 26,
  };
  // Bad 10K — 44:43 (predicted ~41:35 → ~30s/mi slow)
  const slow10k = {
    slug: 'bad-10k', activityId: 101, name: 'Off-Day 10K',
    date: dayOffsetISO(-2),
    distanceMi: 6.2, finishS: 2683, daysAgo: 2,
  };
  // Move base A-race further out — we want runner to be in a building
  // posture, not tapering, so retrospect actually has a next cycle to
  // soften.
  const nextA = {
    ...base.races.nextA!,
    daysAway: 14 * 7,
    date: dayOffsetISO(14 * 7),
  };
  return {
    ...base,
    races: {
      nextA, nextAny: nextA, inWindow: [nextA],
      recent: [slow10k, prior5k],
      raceCount30d: 2,
    },
    // 10K recovery window is 7 days from race; race was 2 days ago
    recoveryWindowEndsISO: dayOffsetISO(5),
  };
})();

// ─────────────────────────────────────────────────────────────────
// K5 — Good B-race (raced ~20s/mi faster than VDOT predicted).
//   Prior 5K 12wks ago at VDOT 49 (20:00). 10K B-race 2 days ago at
//   38:30 (~6:13/mi) → predicted at VDOT 49 was 41:35 (~6:42/mi). So
//   ~30s/mi faster, computing to VDOT ~53 from the 10K alone.
//   Assertion: retrospect acknowledges; vdotSnapshot updates to the
//   new 10K-derived ~53; but the engine must NOT linearly project a
//   +4 VDOT jump — Daniels caps ~1.0/cycle for trained runners.
// ─────────────────────────────────────────────────────────────────
export const STATE_GOOD_B_RACE_RESULT: CoachState = (() => {
  const base = buildMidBuildBase();
  const prior5k = {
    slug: 'old-5k', activityId: 102, name: 'Winter 5K',
    date: dayOffsetISO(-26), distanceMi: 3.1, finishS: 1200, daysAgo: 26,
  };
  const fast10k = {
    slug: 'fast-10k', activityId: 103, name: 'Breakthrough 10K',
    date: dayOffsetISO(-2), distanceMi: 6.2, finishS: 2310, daysAgo: 2,
  };
  const nextA = {
    ...base.races.nextA!,
    daysAway: 14 * 7,
    date: dayOffsetISO(14 * 7),
  };
  return {
    ...base,
    races: {
      nextA, nextAny: nextA, inWindow: [nextA],
      recent: [fast10k, prior5k],
      raceCount30d: 2,
    },
    recoveryWindowEndsISO: dayOffsetISO(5),
  };
})();

// ─────────────────────────────────────────────────────────────────
// K6 — Heatwave / disruption.
//   No env-disruption field exists on CoachState today. Modelled via
//   poor check-in pattern (heat → poor sleep → low energy) +
//   `last7Mi` at 60% of weeklyAvg4w (the runner couldn't log planned
//   volume). The engine's adaptive layer should read both signals.
//   Real env-flag is a documented GAP — surfaces in the final report.
// ─────────────────────────────────────────────────────────────────
export const STATE_HEATWAVE_DISRUPTION: CoachStateWithCheckin = (() => {
  const base = buildMidBuildBase();
  const checkin: CheckinAggregate = {
    ...emptyCheckin(),
    rowsCount: 5,
    avgEnergy: 4, avgSoreness: 5, avgStress: 6,
    poorDaysCount: 5,
    latestDateISO: dayOffsetISO(0),
    loggedToday: true,
  };
  // Logged miles cratered to ~60% of planned/avg
  const planned = base.volume.weeklyAvg4w;
  const last7Mi = Math.round(planned * 0.6);
  return {
    ...base,
    volume: {
      ...base.volume,
      last7Mi,                        // 60% of weeklyAvg4w
      last28Mi: Math.round(base.volume.last28Mi * 0.85),
      deltaPct4v4: -0.25,
    },
    checkin,
  };
})();

// ─────────────────────────────────────────────────────────────────
// K7 — Two B-races stacked within a week of an A-race.
//   A-race 14 days out. B-race day 7 (half the way there), B-race day
//   10. Engine should:
//     (a) decline to load up around the B-races, and
//     (b) emit B-race days as `race` type in the plan (gap today).
//   We can only assert (a) given current engine behavior.
//   B-races appear via state.races.inWindow with priority 'B'.
// ─────────────────────────────────────────────────────────────────
export const STATE_STACKED_B_RACES: CoachState = (() => {
  const base = buildMidBuildBase();
  const aRace = {
    slug: 'a-race', name: 'Goal Half', date: dayOffsetISO(14),
    distanceMi: 13.1, goalDisplay: '1:30', goalFinishS: 5400,
    priority: 'A' as const, daysAway: 14,
  };
  const b1 = {
    slug: 'b-tune-up', name: 'Tune-up 5K', date: dayOffsetISO(7),
    distanceMi: 3.1, goalDisplay: '20:00', goalFinishS: 1200,
    priority: 'B' as const, daysAway: 7,
  };
  const b2 = {
    slug: 'b-tune-up-2', name: 'Tune-up 10K', date: dayOffsetISO(10),
    distanceMi: 6.2, goalDisplay: '42:00', goalFinishS: 2520,
    priority: 'B' as const, daysAway: 10,
  };
  return {
    ...base,
    races: {
      nextA: aRace, nextAny: aRace,
      inWindow: [b1, b2, aRace],
      recent: [], raceCount30d: 0,
    },
    // Already in late-build / peak with peaky volume
    volume: {
      ...base.volume,
      last7Mi: 38, last28Mi: 150,
      weeklyAvg4w: 37, weeklyAvg8w: 36, longestLast28Mi: 14,
      deltaPct4v4: 0.05,
    },
    intensity: { easyMi14d: 56, hardMi14d: 19, easyShare14d: 0.75 },
  };
})();

// ─────────────────────────────────────────────────────────────────
// K8 — Long streak then 5-day break.
//   60 consecutive run-days then a 5-day gap. Today: runner is back.
//   Engine should: recognize the runner is fit (high last28Mi /
//   weeklyAvg8w), but not pretend the streak is intact. Today gets a
//   moderate-easy prescription, and the rebuild ramp is gradual.
//
//   Implementation: rebuildAfterBreak flag is computed by gatherCoachState
//   as `last7Mi ≤ last28Mi/4 * 0.30`. With a 5-day gap (only 2 run days
//   in last 7), that fires. last28Mi remains high because the prior
//   streak counts. daysSinceLastRun reflects the gap.
// ─────────────────────────────────────────────────────────────────
export const STATE_LONG_STREAK_THEN_BREAK: CoachState = (() => {
  const base = buildMidBuildBase();
  // Prior fitness was strong — 50mpw average from the 60-day streak.
  const weeklyAvg4w = 50, weeklyAvg8w = 50;
  // Last 7 days: 2 run days then a 5-day gap. Total ~12mi vs typical 50.
  // 12 ≤ 100/4 * 0.30 = 7.5? No — 12 > 7.5. Need to drop more aggressively.
  // Use 6mi over the 2 active days only. 6 ≤ 50/4*0.30 = 3.75? Still not.
  // The trigger formula: last7Mi ≤ last28Mi/4 * 0.30 → last7Mi ≤ 200/4 * 0.30 = 15.
  // With last28Mi = 200 (4 weeks at 50mpw), last7Mi must be ≤15.
  const last28Mi = 200;
  const last7Mi = 6;
  return {
    ...base,
    volume: {
      ...base.volume,
      last7Mi, last28Mi,
      weeklyAvg4w, weeklyAvg8w,
      longestLast28Mi: 16,
      deltaPct4v4: -0.60,
      last7Days: [-6, -5, -4, -3, -2, -1, 0].map((off, i) => ({
        date: dayOffsetISO(off),
        miles: i < 2 ? 3 : 0,
        runs: i < 2 ? 1 : 0,
      })),
    },
    intensity: { easyMi14d: 28, hardMi14d: 6, easyShare14d: 0.82 },
    recovery: {
      ...base.recovery,
      daysSinceLastRun: 5,
      consecutiveRunDays: 0,
      yesterday: null,
    },
    flags: { ...base.flags, rebuildAfterBreak: true },
  };
})();

// ─────────────────────────────────────────────────────────────────
// K9 — Returning from illness.
//   No `illness` flag exists on CoachState today (GAP). Modeled via
//   strong proxy: 4 consecutive poor check-ins (low energy + high
//   stress) + 0 runs in last 4 days. Engine should prescribe easy /
//   recovery / rest the next several days regardless of cycle phase.
// ─────────────────────────────────────────────────────────────────
export const STATE_ILLNESS_RETURN: CoachStateWithCheckin = (() => {
  const base = buildMidBuildBase();
  const checkin: CheckinAggregate = {
    ...emptyCheckin(),
    rowsCount: 4,
    avgEnergy: 2, avgSoreness: 2, avgStress: 8,
    poorDaysCount: 4,
    latestDateISO: dayOffsetISO(0),
    loggedToday: true,
  };
  return {
    ...base,
    volume: {
      ...base.volume,
      last7Mi: 0,
      last28Mi: 80,
      weeklyAvg4w: 25, weeklyAvg8w: 28,
      deltaPct4v4: -0.50,
      last7Days: [-6, -5, -4, -3, -2, -1, 0].map((off) => ({
        date: dayOffsetISO(off),
        miles: 0,
        runs: 0,
      })),
    },
    intensity: { easyMi14d: 10, hardMi14d: 2, easyShare14d: 0.83 },
    recovery: {
      ...base.recovery,
      daysSinceLastRun: 4,
      consecutiveRunDays: 0,
      yesterday: null,
    },
    flags: { ...base.flags, rebuildAfterBreak: true },
    checkin,
  };
})();

// ─────────────────────────────────────────────────────────────────
// K10 — First race in a new distance.
//   Runner has 4 half-marathon races on file (best ~1:35 = VDOT ~50).
//   No prior marathons. A-race is a MARATHON 12 weeks out.
//   Assertion: raceFitnessPrediction should still produce a target
//   (Riegel from half VDOT) but flag the first-time-distance caveat
//   (e.g. via lower confidence). The plan must ramp the long run
//   appropriately (marathon needs 18-22mi LR, not 13-15).
//
//   Implementation: vdotSnapshot picks the most recent half (within 28d).
// ─────────────────────────────────────────────────────────────────
export const STATE_FIRST_MARATHON: CoachState = (() => {
  const base = buildMidBuildBase();
  const halfPRTime = 5700; // 1:35
  // 4 halves — recent one within 28d so vdotSnapshot has a current source.
  const halves = [
    { slug: 'h1', activityId: 200, name: 'Late Half', date: dayOffsetISO(-20), distanceMi: 13.1, finishS: halfPRTime, daysAgo: 20 },
    { slug: 'h2', activityId: 201, name: 'Earlier Half', date: dayOffsetISO(-25), distanceMi: 13.1, finishS: halfPRTime + 60, daysAgo: 25 },
  ];
  const aMarathon = {
    slug: 'first-marathon', name: 'First Marathon', date: dayOffsetISO(12 * 7),
    distanceMi: 26.2, goalDisplay: '3:30', goalFinishS: 12600,
    priority: 'A' as const, daysAway: 12 * 7,
  };
  return {
    ...base,
    races: {
      nextA: aMarathon, nextAny: aMarathon,
      inWindow: [aMarathon],
      recent: halves,
      raceCount30d: 1,
    },
    volume: {
      ...base.volume,
      last7Mi: 35, last28Mi: 140,
      weeklyAvg4w: 35, weeklyAvg8w: 35,
      longestLast28Mi: 14,
      deltaPct4v4: 0.05,
    },
  };
})();
