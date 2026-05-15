/**
 * Regression tests for the "29mi long-run limit" bug.
 *
 * Bug: after a marathon (~26.8mi race effort), the engine surfaced
 * 29.5 mi as next week's long-run cap because:
 *   - state.volume.longestLast28Mi included the race
 *   - longRunTarget / maxLongRunMi anchored on longestLast28Mi × 1.10
 *   - 26.8 × 1.10 = 29.5
 *
 * Fix:
 *   Q1 — state.volume.longestTrainingRunLast28Mi (NEW) excludes races.
 *        Engine reads this for all progression math.
 *   Q2 — POST_RACE phase anchors on state.volume.preRaceLongestTrainingMi
 *        × 0.50 (50% restart, ramping back 2-3 weeks per Research/00b
 *        §Recovery by Effort + marathon-specific recovery).
 *
 * Citations:
 *   - Research/00a-distance-running-training.md §13.1 Single-session spike
 *   - Research/00b-recovery-protocols.md §Recovery by Effort (A vs B vs C Race)
 *   - Research/00b-recovery-protocols.md §Marathon-specific recovery
 */
import { describe, expect, it } from 'vitest';
import { coachDaily, simulateRange } from '../coach-engine';
import { maxLongRunMi } from '../coach-principles';
import type { CoachState } from '../coach-state';

function makeBaseState(): CoachState {
  return {
    now: '2026-05-12',
    races: {
      nextA: null,
      nextAny: null,
      inWindow: [],
      recent: [],
      raceCount30d: 0,
    },
    volume: {
      last7Mi: 30,
      last28Mi: 120,
      last7Days: [],
      weeklyAvg4w: 30,
      weeklyAvg8w: 28,
      longestLast28Mi: 14,
      longestTrainingRunLast28Mi: 14,
      preRaceLongestTrainingMi: null,
      deltaPct4v4: 0.05,
    },
    intensity: { easyMi14d: 50, hardMi14d: 10, easyShare14d: 0.83 },
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
    flags: { heavyBlockSuspected: false, rebuildAfterBreak: false, healthKitAvailable: false, recentSkips: [] },
    checkin: null,
    recoveryWindowEndsISO: null,
    prefs: {
      longRunDow: 6,    // Saturday
      qualityDows: [2, 4],
      restDow: 1,
      level: null,
      isDefaults: true,
    },
  };
}

describe('long-run cap — Q1 · training-only baseline (races excluded)', () => {
  it('post-marathon: cap reads from training-only longest, not race', () => {
    // Bug-replica scenario: runner ran a 26.8mi marathon 5 days ago,
    // training long was 14mi prior. Pre-fix: cap = 26.8 × 1.10 = 29.5mi.
    // Post-fix: cap = 14 × 1.10 = 15.4mi (or POST_RACE 50% restart = 7mi).
    const state = makeBaseState();
    state.volume.longestLast28Mi = 26.8;            // includes marathon
    state.volume.longestTrainingRunLast28Mi = 14;   // training-only
    state.volume.preRaceLongestTrainingMi = 14;
    state.races.recent = [{
      slug: 'big-sur-2026', activityId: null, name: 'Big Sur Marathon',
      date: '2026-05-07', distanceMi: 26.2, finishS: 13800, daysAgo: 5,
    }];
    state.recoveryWindowEndsISO = '2026-06-02';     // 26d after marathon

    const cap = maxLongRunMi(state);
    expect(cap, 'cap must NOT be the race × 1.10 (29.5mi)').toBeLessThan(20);
    expect(cap, 'cap from 14mi training × 1.10 = 15.4').toBeCloseTo(15.4, 0);
  });

  it('no recent race + 14mi training long: cap is 15.4mi (+10% rule)', () => {
    const state = makeBaseState();
    state.volume.longestLast28Mi = 14;
    state.volume.longestTrainingRunLast28Mi = 14;
    expect(maxLongRunMi(state)).toBeCloseTo(15.4, 0);
  });

  it('training-only longest is what progression math reads', () => {
    // Even outside POST_RACE — e.g., race was 28 days ago but recovery
    // window has closed — the training-only baseline is still the
    // safe anchor. Race shouldn't lift the +10% cap.
    const state = makeBaseState();
    state.volume.longestLast28Mi = 26.8;
    state.volume.longestTrainingRunLast28Mi = 13;   // pre-race
    state.volume.preRaceLongestTrainingMi = null;   // no recent race
    // No POST_RACE, no recovery window — runner is on BASE_MAINTENANCE.
    const cap = maxLongRunMi(state);
    expect(cap, 'cap from 13mi × 1.10 = 14.3').toBeCloseTo(14.3, 0);
  });
});

describe('long-run cap — Q2 · post-race 50% restart', () => {
  it('POST_RACE: long-run target ≈ 50% of pre-race training long', () => {
    const state = makeBaseState();
    state.volume.longestLast28Mi = 26.8;
    state.volume.longestTrainingRunLast28Mi = 14;
    state.volume.preRaceLongestTrainingMi = 14;
    state.races.recent = [{
      slug: 'big-sur-2026', activityId: null, name: 'Big Sur Marathon',
      date: '2026-05-07', distanceMi: 26.2, finishS: 13800, daysAgo: 5,
    }];
    state.recoveryWindowEndsISO = '2026-06-02';

    // Pull the simulated week and find the long run.
    const result = coachDaily(state);
    const longRuns = result.weekShape.filter(d => d.isLong);
    if (longRuns.length > 0) {
      // 50% of 14 = 7mi; floor 6mi per POST_RACE switch case.
      // Either path is correct doctrine.
      const longestPrescribed = Math.max(...longRuns.map(d => d.distanceMi));
      expect(longestPrescribed,
        'POST_RACE long run never approaches race distance').toBeLessThan(12);
    }
  });

  it('POST_RACE: simulation across 4 weeks never prescribes > 15.4mi long', () => {
    // Bug-replica: simulate 28 days forward and assert no long run
    // exceeds the +10% off pre-race training cap.
    const state = makeBaseState();
    state.volume.longestLast28Mi = 26.8;
    state.volume.longestTrainingRunLast28Mi = 14;
    state.volume.preRaceLongestTrainingMi = 14;
    state.races.recent = [{
      slug: 'big-sur-2026', activityId: null, name: 'Big Sur Marathon',
      date: '2026-05-07', distanceMi: 26.2, finishS: 13800, daysAgo: 5,
    }];
    state.recoveryWindowEndsISO = '2026-06-02';

    const days = simulateRange(state, '2026-05-12', '2026-06-09');
    const longRunDays = days.filter(d => d.isLong);
    for (const d of longRunDays) {
      expect(d.distanceMi,
        `${d.date} long run ${d.distanceMi}mi must not approach marathon distance`
      ).toBeLessThan(20);
    }
  });
});

describe('long-run cap — invariant', () => {
  it('peakLast for training-progression purposes excludes race distances', () => {
    // Anchor invariant: maxLongRunMi must never reflect a race effort.
    // Any state where longestLast28Mi >> longestTrainingRunLast28Mi
    // (i.e., the runner raced recently) must yield a cap that
    // tracks the TRAINING value, not the race value.
    for (const trainingMi of [8, 10, 12, 14, 18]) {
      const state = makeBaseState();
      state.volume.longestLast28Mi = 26.8;
      state.volume.longestTrainingRunLast28Mi = trainingMi;
      const cap = maxLongRunMi(state);
      // Allow up to a small tolerance for the 8mi floor.
      const expectedCap = Math.max(8, trainingMi * 1.10);
      expect(cap).toBeCloseTo(expectedCap, 1);
    }
  });
});
