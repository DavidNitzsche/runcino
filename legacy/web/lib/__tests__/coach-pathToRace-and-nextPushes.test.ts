/**
 * Wave G · pathToRace + nextPushes regression tests.
 *
 * These tests pin the two coach methods that back the new alive-coach
 * surfaces (PathToRaceCard, NextPushCard). They cover the math, the
 * empty-state path, and the priority/suppression rules for pushes.
 *
 * @research Research/01-pace-zones-vdot.md §How to recalibrate paces
 * @research Research/00a-distance-running-training.md §Volume progression rules
 * @research Research/00a-distance-running-training.md §The Seven Workout Categories
 */
import { describe, expect, it } from 'vitest';
import { coach } from '../../coach/coach';
import type { CoachState } from '../coach-state';

/** Build a "trained, mid-build" runner with a recent half-marathon
 *  that pegs VDOT around 49. Used as the base for both test suites; each
 *  test overrides specific fields. */
function makeTrainedState(overrides: Partial<CoachState> = {}): CoachState {
  const base: CoachState = {
    now: '2026-05-12',
    races: {
      nextA: {
        slug: 'afc-half-2026',
        name: 'AFC Half',
        date: '2026-08-16',
        distanceMi: 13.1,
        goalDisplay: '1:35',
        goalFinishS: 5700,
        priority: 'A',
        daysAway: 96,
      },
      nextAny: {
        slug: 'afc-half-2026',
        name: 'AFC Half',
        date: '2026-08-16',
        distanceMi: 13.1,
        goalDisplay: '1:35',
        goalFinishS: 5700,
        priority: 'A',
        daysAway: 96,
      },
      inWindow: [],
      // A recent ~1:36 half = VDOT roughly 49.
      recent: [
        {
          slug: 'sample-half',
          activityId: 1,
          name: 'Sample Half',
          date: '2026-04-12',
          distanceMi: 13.1,
          finishS: 5760, // 1:36:00
          daysAgo: 30,
        },
      ],
      raceCount30d: 0,
    },
    volume: {
      last7Mi: 32,
      last28Mi: 128,
      last7Days: [
        { date: '2026-05-06', miles: 6, runs: 1 },
        { date: '2026-05-07', miles: 5, runs: 1 },
        { date: '2026-05-08', miles: 0, runs: 0 },
        { date: '2026-05-09', miles: 8, runs: 1 },
        { date: '2026-05-10', miles: 6, runs: 1 },
        { date: '2026-05-11', miles: 0, runs: 0 },
        { date: '2026-05-12', miles: 7, runs: 1 },
      ],
      weeklyAvg4w: 32,
      weeklyAvg8w: 30,
      longestLast28Mi: 12,
      longestTrainingRunLast28Mi: 12,
      preRaceLongestTrainingMi: null,
      deltaPct4v4: 0.1,
    },
    intensity: {
      easyMi14d: 52,
      hardMi14d: 12,
      easyShare14d: 0.81,
    },
    recovery: {
      daysSinceLastRun: 0,
      consecutiveRunDays: 1,
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
      healthKitAvailable: false, recentSkips: [],
    },
    checkin: null,
    recoveryWindowEndsISO: null,
    prefs: {
      longRunDow: 6, qualityDows: [2, 4], restDow: 1, level: null, isDefaults: true,
    },
  };
  return { ...base, ...overrides };
}

// ── pathToRace ───────────────────────────────────────────────────────

describe('coach.pathToRace', () => {
  it('returns a numeric gap, weeksNeeded, and feasibility verdict for a typical build', async () => {
    const state = makeTrainedState();
    const decision = await coach.pathToRace({
      today: state.now,
      state,
      raceName: state.races.nextA!.name,
      raceDateISO: state.races.nextA!.date,
      raceDistanceMi: state.races.nextA!.distanceMi,
      goalTimeS: state.races.nextA!.goalFinishS!,
    });

    const r = decision.answer;
    expect(r.currentFitness).not.toBeNull();
    expect(r.currentFitness!.vdot).toBeGreaterThan(40);
    expect(r.currentFitness!.vdot).toBeLessThan(60);
    expect(r.weeksAvailable).toBeGreaterThan(10);
    expect(r.gapSPerMi).not.toBeNull();
    expect(typeof r.weeksNeeded).toBe('number');
    expect(r.feasibility).toMatch(/ahead|on_track|tight|behind/);
    expect(decision.brain).toBe('deterministic');
    expect(decision.citations.length).toBeGreaterThan(0);
  });

  it('returns ahead feasibility when goal is slower than VDOT predicts', async () => {
    const state = makeTrainedState();
    const decision = await coach.pathToRace({
      today: state.now,
      state,
      raceName: state.races.nextA!.name,
      raceDateISO: state.races.nextA!.date,
      raceDistanceMi: state.races.nextA!.distanceMi,
      goalTimeS: 6600, // 1:50 half, easy for a 1:36 runner
    });

    expect(decision.answer.feasibility).toBe('ahead');
    // gap = goalPace − predictedPace; positive = goal is slower than
    // predicted = fitness ahead of goal (room to spare).
    expect(decision.answer.gapSPerMi).toBeGreaterThan(0);
    expect(decision.answer.weeksNeeded).toBe(0);
    expect(decision.answer.nextMove).toMatch(/protect|ahead/i);
  });

  it('returns behind feasibility when goal sits far below current fitness', async () => {
    const state = makeTrainedState();
    const decision = await coach.pathToRace({
      today: state.now,
      state,
      raceName: state.races.nextA!.name,
      raceDateISO: state.races.nextA!.date,
      raceDistanceMi: state.races.nextA!.distanceMi,
      goalTimeS: 4800, // 1:20 half, way faster than VDOT 49 can support
    });

    expect(decision.answer.feasibility).toBe('behind');
    // gap negative = goal pace is faster than predicted = fitness short.
    expect(decision.answer.gapSPerMi).toBeLessThan(0);
    expect(decision.answer.weeksNeeded).toBeGreaterThan(decision.answer.weeksAvailable);
  });

  it('returns null fitness + empty-state move when no VDOT-eligible race exists', async () => {
    const state = makeTrainedState({
      races: {
        nextA: makeTrainedState().races.nextA,
        nextAny: makeTrainedState().races.nextA,
        inWindow: [],
        recent: [], // no past races → no VDOT
        raceCount30d: 0,
      },
    });
    const decision = await coach.pathToRace({
      today: state.now,
      state,
      raceName: state.races.nextA!.name,
      raceDateISO: state.races.nextA!.date,
      raceDistanceMi: state.races.nextA!.distanceMi,
      goalTimeS: 5700,
    });

    expect(decision.answer.currentFitness).toBeNull();
    expect(decision.answer.gapSPerMi).toBeNull();
    expect(decision.answer.weeksNeeded).toBeNull();
    expect(decision.answer.feasibility).toBe('unknown');
    expect(decision.answer.nextMove).toMatch(/log/i);
  });

  it('weeksNeeded math: ahead-of-goal closes in 0 weeks', async () => {
    const state = makeTrainedState();
    const decision = await coach.pathToRace({
      today: state.now,
      state,
      raceName: 'AFC Half',
      raceDateISO: '2026-08-16',
      raceDistanceMi: 13.1,
      goalTimeS: 7200, // 2:00, well slower than predicted
    });
    expect(decision.answer.weeksNeeded).toBe(0);
  });
});

// ── nextPushes ───────────────────────────────────────────────────────

describe('coach.nextPushes', () => {
  it('fires "extend long run" when last >10mi was >21 days ago', async () => {
    // longestLast28Mi sits below the 10mi bar = no qualifying long run
    // in 28 days. With an upcoming A race and no recovery window, the
    // push should fire.
    const state = makeTrainedState({
      volume: {
        ...makeTrainedState().volume,
        longestLast28Mi: 8, // < 10mi → counts as 28+ days since long
        last7Days: [
          { date: '2026-05-06', miles: 6, runs: 1 },
          { date: '2026-05-07', miles: 5, runs: 1 },
          { date: '2026-05-08', miles: 0, runs: 0 },
          { date: '2026-05-09', miles: 8, runs: 1 },
          { date: '2026-05-10', miles: 6, runs: 1 },
          { date: '2026-05-11', miles: 0, runs: 0 },
          { date: '2026-05-12', miles: 7, runs: 1 },
        ],
      },
    });
    const decision = await coach.nextPushes({ today: state.now, state });
    const ids = decision.answer.pushes.map((p) => p.id);
    expect(ids).toContain('extend_long_run');

    const push = decision.answer.pushes.find((p) => p.id === 'extend_long_run')!;
    expect(push.urgency).toBe('high');
    expect(push.signal).toMatch(/10mi|28 days/i);
    expect(push.action).toMatch(/long run/i);
    expect(push.citations.length).toBeGreaterThan(0);
  });

  it('does NOT fire "extend long run" when a recent long run is in last 7 days', async () => {
    const state = makeTrainedState({
      volume: {
        ...makeTrainedState().volume,
        longestLast28Mi: 12,
        last7Days: [
          { date: '2026-05-06', miles: 6, runs: 1 },
          { date: '2026-05-07', miles: 5, runs: 1 },
          { date: '2026-05-08', miles: 0, runs: 0 },
          { date: '2026-05-09', miles: 8, runs: 1 },
          { date: '2026-05-10', miles: 6, runs: 1 },
          { date: '2026-05-11', miles: 12, runs: 1 }, // recent long
          { date: '2026-05-12', miles: 0, runs: 0 },
        ],
      },
    });
    const decision = await coach.nextPushes({ today: state.now, state });
    const ids = decision.answer.pushes.map((p) => p.id);
    expect(ids).not.toContain('extend_long_run');
  });

  it('returns empty pushes when state is steady (no signals firing)', async () => {
    const state = makeTrainedState({
      volume: {
        ...makeTrainedState().volume,
        longestLast28Mi: 12,
        last7Mi: 32,
        weeklyAvg4w: 32,
        last7Days: [
          { date: '2026-05-06', miles: 6, runs: 1 },
          { date: '2026-05-07', miles: 5, runs: 1 },
          { date: '2026-05-08', miles: 12, runs: 1 }, // recent long
          { date: '2026-05-09', miles: 0, runs: 0 },
          { date: '2026-05-10', miles: 6, runs: 1 },
          { date: '2026-05-11', miles: 0, runs: 0 },
          { date: '2026-05-12', miles: 3, runs: 1 },
        ],
      },
      intensity: {
        easyMi14d: 56,
        hardMi14d: 8,
        easyShare14d: 0.85,
      },
    });
    const decision = await coach.nextPushes({ today: state.now, state });
    expect(decision.answer.pushes.length).toBe(0);
    expect(decision.answer.rationale).toMatch(/no actionable|steady/i);
  });

  it('fires "add threshold" push when zero quality miles in last 14 days', async () => {
    const state = makeTrainedState({
      volume: {
        ...makeTrainedState().volume,
        longestLast28Mi: 12,
        last7Days: [
          { date: '2026-05-06', miles: 6, runs: 1 },
          { date: '2026-05-07', miles: 5, runs: 1 },
          { date: '2026-05-08', miles: 12, runs: 1 },
          { date: '2026-05-09', miles: 0, runs: 0 },
          { date: '2026-05-10', miles: 6, runs: 1 },
          { date: '2026-05-11', miles: 0, runs: 0 },
          { date: '2026-05-12', miles: 3, runs: 1 },
        ],
      },
      intensity: {
        easyMi14d: 64,
        hardMi14d: 0,
        easyShare14d: 1.0,
      },
    });
    const decision = await coach.nextPushes({ today: state.now, state });
    const ids = decision.answer.pushes.map((p) => p.id);
    expect(ids).toContain('add_threshold');
  });

  it('suppresses build pushes when runner is in post-race recovery window', async () => {
    const state = makeTrainedState({
      volume: {
        ...makeTrainedState().volume,
        longestLast28Mi: 8, // would normally fire extend_long_run
      },
      flags: {
        heavyBlockSuspected: false,
        rebuildAfterBreak: false,
        healthKitAvailable: false, recentSkips: [],
      },
      recoveryWindowEndsISO: '2026-05-20', // recovery window still open
    });
    const decision = await coach.nextPushes({ today: state.now, state });
    const ids = decision.answer.pushes.map((p) => p.id);
    expect(ids).not.toContain('extend_long_run');
    expect(ids).not.toContain('add_threshold');
    expect(ids).not.toContain('volume_cliff');
  });

  it('caps at 3 pushes and sorts by urgency', async () => {
    const state = makeTrainedState({
      volume: {
        ...makeTrainedState().volume,
        longestLast28Mi: 6, // long run erosion (high)
        last7Mi: 5,         // volume cliff (high)
        weeklyAvg4w: 30,
      },
      intensity: {
        easyMi14d: 8,
        hardMi14d: 0,
        easyShare14d: 0.6,  // grey-zone drift (high)
      },
    });
    const decision = await coach.nextPushes({ today: state.now, state });
    expect(decision.answer.pushes.length).toBeLessThanOrEqual(3);
    expect(decision.answer.pushes[0]!.urgency).toBe('high');
  });
});
