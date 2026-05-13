/**
 * Canonical CoachState fixtures — one per runner archetype the engine
 * must handle. Each fixture is a hand-tuned snapshot that triggers a
 * specific doctrine path; the partner test file (coach-engine-scenarios)
 * walks 28 days forward via simulateRange and asserts the engine
 * produces a plan a competent human coach would sign off on.
 *
 * Why fixtures and not real data:
 *   - Real strava + race state is dependent on a Postgres + cache that
 *     unit tests can't reach. Fixtures let us pin every input.
 *   - Each fixture isolates ONE archetype. When a scenario regresses we
 *     know exactly which class of runner broke.
 *   - "Today" is anchored at runtime (`new Date()`) so the fixtures
 *     stay valid as the calendar moves forward.
 *
 * Conventions:
 *   - All dates are ISO `YYYY-MM-DD`, generated from today via dayOffsetISO.
 *   - `state.now` is always today.
 *   - Each fixture is built by a make* function so callers can override
 *     specific fields if a single test needs a slight variant.
 *
 * Notes for the engine reader:
 *   - The `inWindow` race array is the distance-aware build window
 *     (HM=84d, Marathon=112d). Fixtures populate it consistently with
 *     daysAway so the engine's mode/phase routing matches real
 *     gatherCoachState output.
 */
import type { CoachState } from '../../coach-state';

/** ISO date `dayOffset` days from today (anchored at noon UTC of the
 *  local date so setDate/getDate math is timezone-safe). */
export function dayOffsetISO(daysFromToday: number, anchor: Date = new Date()): string {
  const base = new Date(Date.UTC(
    anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 12, 0, 0,
  ));
  base.setUTCDate(base.getUTCDate() + daysFromToday);
  return base.toISOString().slice(0, 10);
}

export const TODAY_ISO = dayOffsetISO(0);

// ─────────────────────────────────────────────────────────────────
// Default-prefs object. Most fixtures are testing engine behavior
// against the runner-standard cadence (Sat long / Tue+Thu quality /
// Mon rest). Tests that exercise custom prefs override this inline.
// ─────────────────────────────────────────────────────────────────
const DEFAULT_PREFS: CoachState['prefs'] = {
  longRunDow: 6,           // Saturday
  qualityDows: [2, 4],     // Tue / Thu
  restDow: 1,              // Monday
  level: null,
  isDefaults: true,
};

// Default training-only volume signals for fixtures. Several fixtures
// predate the longestTrainingRunLast28Mi / preRaceLongestTrainingMi
// fields; this helper keeps the shape compact at each site.
function defaultTrainingVolume(longestMi: number, preRaceMi: number | null = null) {
  return {
    longestTrainingRunLast28Mi: longestMi,
    preRaceLongestTrainingMi: preRaceMi,
  };
}

// ─────────────────────────────────────────────────────────────────
// Helper: build a NextRace object for the fixture's nextA slot.
// ─────────────────────────────────────────────────────────────────
function buildNextRace(opts: {
  slug: string;
  name: string;
  daysAway: number;
  distanceMi: number;
  goalDisplay: string;
  goalFinishS: number | null;
  priority?: 'A' | 'B' | 'C';
}) {
  return {
    slug: opts.slug,
    name: opts.name,
    date: dayOffsetISO(opts.daysAway),
    distanceMi: opts.distanceMi,
    goalDisplay: opts.goalDisplay,
    goalFinishS: opts.goalFinishS,
    priority: (opts.priority ?? 'A') as 'A' | 'B' | 'C',
    daysAway: opts.daysAway,
  };
}

// ─────────────────────────────────────────────────────────────────
// 1. STATE_POST_HALF_DAY_3
// Runner: finished a half-marathon 3 days ago, has an A-race 12 weeks
//   out, no heavy-block accumulation.
// Engine should: prescribe REST/recovery in the post-race window
//   (~14 days for a half), zero quality work inside it, then re-engage
//   with structured base training the week after the window closes.
// ─────────────────────────────────────────────────────────────────
export const STATE_POST_HALF_DAY_3: CoachState = (() => {
  // Half-marathon recovery window: race day + 14 days. Race was 3 days
  // ago, so the window ends ~11 days from today.
  const nextA = buildNextRace({
    slug: 'fall-half-2026',
    name: 'Fall Half',
    daysAway: 12 * 7,       // 12 weeks
    distanceMi: 13.1,
    goalDisplay: '1:45',
    goalFinishS: 6300,
  });
  return {
    now: TODAY_ISO,
    races: {
      nextA,
      nextAny: nextA,
      inWindow: [nextA],      // 84d HM build window → 84d=84, 12w*7=84 → in window
      recent: [
        {
          slug: 'spring-half',
          activityId: 1,
          name: 'Spring Half',
          date: dayOffsetISO(-3),
          distanceMi: 13.1,
          finishS: 6600,
          daysAgo: 3,
        },
      ],
      raceCount30d: 1,
    },
    volume: {
      last7Mi: 8,             // tapered for race week
      last28Mi: 100,          // ~25mi/wk
      last7Days: [],
      weeklyAvg4w: 25,
      weeklyAvg8w: 26,
      longestLast28Mi: 13.1,
      ...defaultTrainingVolume(10, 11),    // training-long ~10mi; pre-race long 11mi
      deltaPct4v4: -0.05,
    },
    intensity: { easyMi14d: 35, hardMi14d: 12, easyShare14d: 0.74 },
    recovery: {
      daysSinceLastRun: 3,
      consecutiveRunDays: 0,
      yesterday: null,
      today: null,
      hrv7dAvgMs: null,
      rhrBpm: null,
      sleep7dAvgHrs: null,
      strengthDaysThisWeek: null,
    },
    flags: {
      heavyBlockSuspected: false,
      rebuildAfterBreak: false,
      healthKitAvailable: false,
    },
    checkin: null,
    // race -3d + 14d HM recovery = +11d
    recoveryWindowEndsISO: dayOffsetISO(11),
    prefs: DEFAULT_PREFS,
  };
})();

// ─────────────────────────────────────────────────────────────────
// 2. STATE_MID_BUILD_WEEK_4
// Runner: 14 weeks of consistent 30mpw running, currently in build
//   phase with A-race 10 weeks out, no recovery window.
// Engine should: cycle phase through BUILD, prescribe 2 quality
//   days/week, grow the long run over the 4 simulated weeks.
// ─────────────────────────────────────────────────────────────────
export const STATE_MID_BUILD_WEEK_4: CoachState = (() => {
  const nextA = buildNextRace({
    slug: 'autumn-half-2026',
    name: 'Autumn Half',
    daysAway: 10 * 7,       // 10 weeks → 70d, inside HM 84d window
    distanceMi: 13.1,
    goalDisplay: '1:35',
    goalFinishS: 5700,
  });
  return {
    now: TODAY_ISO,
    races: {
      nextA,
      nextAny: nextA,
      inWindow: [nextA],
      recent: [],
      raceCount30d: 0,
    },
    volume: {
      last7Mi: 30,
      last28Mi: 124,          // 28+30+32+34 ramp
      last7Days: [],
      weeklyAvg4w: 31,        // mid-ramp
      weeklyAvg8w: 28,
      longestLast28Mi: 11,
      ...defaultTrainingVolume(11),
      deltaPct4v4: 0.12,
    },
    intensity: { easyMi14d: 45, hardMi14d: 16, easyShare14d: 0.74 },
    recovery: {
      daysSinceLastRun: 1,
      consecutiveRunDays: 4,
      yesterday: { distMi: 5, paceSPerMi: 510, avgHr: 142, name: 'Easy 5', activityId: 11 },
      today: null,
      hrv7dAvgMs: null,
      rhrBpm: null,
      sleep7dAvgHrs: null,
      strengthDaysThisWeek: null,
    },
    flags: {
      heavyBlockSuspected: false,
      rebuildAfterBreak: false,
      healthKitAvailable: false,
    },
    checkin: null,
    recoveryWindowEndsISO: null,
    prefs: DEFAULT_PREFS,
  };
})();

// ─────────────────────────────────────────────────────────────────
// 3. STATE_PEAK_WEEK_MINUS_2
// Runner: A-race 14 days out, peak mileage 38mpw, healthy 75% easy
//   share, no recent races.
// Engine should: drop volume 30–50% across the 14-day taper while
//   preserving quality (Daniels §9 — taper kills volume, holds intensity),
//   no new long-run spikes inside 10 days of race.
// ─────────────────────────────────────────────────────────────────
export const STATE_PEAK_WEEK_MINUS_2: CoachState = (() => {
  const nextA = buildNextRace({
    slug: 'fall-half-peak',
    name: 'Fall Half Peak',
    daysAway: 14,
    distanceMi: 13.1,
    goalDisplay: '1:30',
    goalFinishS: 5400,
  });
  return {
    now: TODAY_ISO,
    races: {
      nextA,
      nextAny: nextA,
      inWindow: [nextA],
      recent: [],             // no race in last 28d
      raceCount30d: 0,
    },
    volume: {
      last7Mi: 38,
      last28Mi: 150,
      last7Days: [],
      weeklyAvg4w: 38,
      weeklyAvg8w: 36,
      longestLast28Mi: 14,
      ...defaultTrainingVolume(14),
      deltaPct4v4: 0.08,
    },
    intensity: { easyMi14d: 56, hardMi14d: 19, easyShare14d: 0.75 },
    recovery: {
      daysSinceLastRun: 1,
      consecutiveRunDays: 5,
      yesterday: { distMi: 6, paceSPerMi: 480, avgHr: 140, name: 'Easy 6', activityId: 21 },
      today: null,
      hrv7dAvgMs: null,
      rhrBpm: null,
      sleep7dAvgHrs: null,
      strengthDaysThisWeek: null,
    },
    flags: {
      heavyBlockSuspected: false,
      rebuildAfterBreak: false,
      healthKitAvailable: false,
    },
    checkin: null,
    recoveryWindowEndsISO: null,
    prefs: DEFAULT_PREFS,
  };
})();

// ─────────────────────────────────────────────────────────────────
// 4. STATE_TAPER_WEEK_MINUS_5
// Runner: A-race 5 days away, volume already cut to 28mpw from a 38mpw
//   peak, no recovery window.
// Engine should: prescribe rest / shakeout / race within the final
//   week; race day shows up in the simulated range as type 'race'.
// ─────────────────────────────────────────────────────────────────
export const STATE_TAPER_WEEK_MINUS_5: CoachState = (() => {
  const nextA = buildNextRace({
    slug: 'imminent-half',
    name: 'Imminent Half',
    daysAway: 5,
    distanceMi: 13.1,
    goalDisplay: '1:35',
    goalFinishS: 5700,
  });
  return {
    now: TODAY_ISO,
    races: {
      nextA,
      nextAny: nextA,
      inWindow: [nextA],
      recent: [],
      raceCount30d: 0,
    },
    volume: {
      last7Mi: 28,            // already dropped
      last28Mi: 130,
      last7Days: [],
      weeklyAvg4w: 28,
      weeklyAvg8w: 34,
      longestLast28Mi: 14,
      ...defaultTrainingVolume(14),
      deltaPct4v4: -0.18,
    },
    intensity: { easyMi14d: 44, hardMi14d: 12, easyShare14d: 0.78 },
    recovery: {
      daysSinceLastRun: 1,
      consecutiveRunDays: 3,
      yesterday: { distMi: 4, paceSPerMi: 510, avgHr: 138, name: 'Shakeout', activityId: 31 },
      today: null,
      hrv7dAvgMs: null,
      rhrBpm: null,
      sleep7dAvgHrs: null,
      strengthDaysThisWeek: null,
    },
    flags: {
      heavyBlockSuspected: false,
      rebuildAfterBreak: false,
      healthKitAvailable: false,
    },
    checkin: null,
    recoveryWindowEndsISO: null,
    prefs: DEFAULT_PREFS,
  };
})();

// ─────────────────────────────────────────────────────────────────
// 5. STATE_EARLY_BASE_REBUILD
// Runner: 0 races in last 60 days, low weekly volume (8mpw), 95% easy
//   share, A-race 16 weeks out, sparse activity (returning runner pattern).
// Engine should: prescribe all easy aerobic running. Frequency-first
//   progression. No quality. Weekly mileage progresses ≤10%/week (10% rule).
// ─────────────────────────────────────────────────────────────────
export const STATE_EARLY_BASE_REBUILD: CoachState = (() => {
  const nextA = buildNextRace({
    slug: 'distant-half',
    name: 'Distant Half',
    daysAway: 16 * 7,        // 112d, OUTSIDE the 84d HM window
    distanceMi: 13.1,
    goalDisplay: '2:00',
    goalFinishS: 7200,
  });
  return {
    now: TODAY_ISO,
    races: {
      nextA,
      nextAny: nextA,
      inWindow: [],            // 112d > 84d build window
      recent: [],
      raceCount30d: 0,
    },
    volume: {
      last7Mi: 8,
      last28Mi: 30,
      last7Days: [],
      weeklyAvg4w: 8,
      weeklyAvg8w: 6,
      longestLast28Mi: 4,
      ...defaultTrainingVolume(4),
      deltaPct4v4: 0.5,
    },
    intensity: { easyMi14d: 14, hardMi14d: 0.7, easyShare14d: 0.95 },
    recovery: {
      daysSinceLastRun: 2,
      consecutiveRunDays: 2,
      yesterday: null,
      today: null,
      hrv7dAvgMs: null,
      rhrBpm: null,
      sleep7dAvgHrs: null,
      strengthDaysThisWeek: null,
    },
    flags: {
      heavyBlockSuspected: false,
      rebuildAfterBreak: false,
      healthKitAvailable: false,
    },
    checkin: null,
    recoveryWindowEndsISO: null,
    prefs: DEFAULT_PREFS,
  };
})();

// ─────────────────────────────────────────────────────────────────
// 6. STATE_HEAVY_BLOCK_STACK
// Runner: 2 races within last 14 days (marathon + half), heavy-block
//   flag set, recovery window 10 days out. Mirrors the original bug
//   scenario from commit a32e1f9.
// Engine should: graduated recovery dominates first 10–14 days; plan
//   re-engages after the window closes; no all-REST stretch past day +14.
// ─────────────────────────────────────────────────────────────────
export const STATE_HEAVY_BLOCK_STACK: CoachState = (() => {
  const nextA = buildNextRace({
    slug: 'afc-half-2026',
    name: 'AFC Half',
    daysAway: 96,             // OUTSIDE the 84d HM build window
    distanceMi: 13.1,
    goalDisplay: '1:45',
    goalFinishS: 6300,
  });
  return {
    now: TODAY_ISO,
    races: {
      nextA,
      nextAny: nextA,
      inWindow: [],
      recent: [
        {
          slug: 'recent-half',
          activityId: 50,
          name: 'Sombrero Half',
          date: dayOffsetISO(-9),
          distanceMi: 13.1,
          finishS: 6600,
          daysAgo: 9,
        },
        {
          slug: 'recent-marathon',
          activityId: 51,
          name: 'Big Sur Marathon',
          date: dayOffsetISO(-15),
          distanceMi: 26.2,
          finishS: 13800,
          daysAgo: 15,
        },
      ],
      raceCount30d: 2,
    },
    volume: {
      last7Mi: 14,
      last28Mi: 72,
      last7Days: [],
      weeklyAvg4w: 18,
      weeklyAvg8w: 22,
      longestLast28Mi: 26.2,
      // Training-only excludes the marathon + half — pre-race training
      // long was ~20mi (typical marathon prep peak).
      ...defaultTrainingVolume(11, 20),
      deltaPct4v4: -0.1,
    },
    intensity: { easyMi14d: 50, hardMi14d: 22, easyShare14d: 0.69 },
    recovery: {
      daysSinceLastRun: 1,
      consecutiveRunDays: 3,
      yesterday: null,
      today: null,
      hrv7dAvgMs: null,
      rhrBpm: null,
      sleep7dAvgHrs: null,
      strengthDaysThisWeek: null,
    },
    flags: {
      heavyBlockSuspected: true,
      rebuildAfterBreak: false,
      healthKitAvailable: false,
    },
    // Marathon was -15d ago + 26 day window = +11d from today
    checkin: null,
    recoveryWindowEndsISO: dayOffsetISO(11),
    prefs: DEFAULT_PREFS,
  };
})();

// ─────────────────────────────────────────────────────────────────
// 7. STATE_INJURY_RETURN
// Runner: returning from injury — long gap (21+ days since last run),
//   very low recent volume (4mpw effective), no quality. There is no
//   `injuryReturning` flag in CoachState; we model it via
//   rebuildAfterBreak + low volume + 21d gap.
// Engine should: all easy. No quality. Volume ≤5mpw in week 1.
//   REBUILD phase should pin distance to baseEasy.
// ─────────────────────────────────────────────────────────────────
export const STATE_INJURY_RETURN: CoachState = (() => {
  // No goal race — pure rebuild scenario. Engine treats this as base
  // mode + REBUILD phase via rebuildAfterBreak flag.
  return {
    now: TODAY_ISO,
    races: {
      nextA: null,
      nextAny: null,
      inWindow: [],
      recent: [],
      raceCount30d: 0,
    },
    volume: {
      last7Mi: 0,             // nothing in last 7d → rebuildAfterBreak triggers
      last28Mi: 4,            // 1 short run 21d ago
      last7Days: [],
      weeklyAvg4w: 4,
      weeklyAvg8w: 6,
      longestLast28Mi: 4,
      ...defaultTrainingVolume(4),
      deltaPct4v4: -0.6,
    },
    intensity: { easyMi14d: 0, hardMi14d: 0, easyShare14d: 1.0 },
    recovery: {
      daysSinceLastRun: 21,
      consecutiveRunDays: 0,
      yesterday: null,
      today: null,
      hrv7dAvgMs: null,
      rhrBpm: null,
      sleep7dAvgHrs: null,
      strengthDaysThisWeek: null,
    },
    flags: {
      heavyBlockSuspected: false,
      rebuildAfterBreak: true,     // last7 ≤ 30% of last28 avg, by definition
      healthKitAvailable: false,
    },
    checkin: null,
    recoveryWindowEndsISO: null,
    prefs: DEFAULT_PREFS,
  };
})();
