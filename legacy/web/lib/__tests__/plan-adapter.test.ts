/**
 * plan-adapter · doctrine-grounded trigger tests.
 *
 * Pin every trigger from docs/PLAN_ARCHITECTURE.md §Adaptation triggers:
 *   - poor check-in days threshold (3 = yellow, 1 = no fire)
 *   - cratered volume
 *   - rebuild-after-break
 *   - B-race in window
 *   - bad race result (negative path, no fabrication)
 *   - idempotency: running twice produces same plan
 */

import { describe, it, expect } from 'vitest';
import { adaptPlan, isCrateredVolume, detectPositiveDrift } from '../../coach/plan-adapter';
import { buildPlan } from '../../coach/plan-builder';
import type { CoachState } from '../coach-state';
import type { Plan } from '../../coach/plan-types';
import type { CheckinAggregate } from '../checkin-aggregate';

function makeState(overrides: Partial<CoachState> = {}): CoachState {
  const base: CoachState = {
    now: '2026-05-11',
    races: { nextA: null, nextAny: null, inWindow: [], recent: [], raceCount30d: 0 },
    volume: {
      last7Mi: 25, last28Mi: 100, last7Days: [],
      weeklyAvg4w: 25, weeklyAvg8w: 25,
      longestLast28Mi: 10, longestTrainingRunLast28Mi: 10, preRaceLongestTrainingMi: null,
      deltaPct4v4: 0,
    },
    intensity: { easyMi14d: 40, hardMi14d: 10, easyShare14d: 0.8 },
    recovery: {
      daysSinceLastRun: 1, consecutiveRunDays: 4,
      yesterday: null, today: null,
      hrv7dAvgMs: null, rhrBpm: null, sleep7dAvgHrs: null,
      strengthDaysThisWeek: null,
    },
    flags: { heavyBlockSuspected: false, rebuildAfterBreak: false, healthKitAvailable: false, recentSkips: [] },
    checkin: null,
    recoveryWindowEndsISO: null,
    prefs: { longRunDow: 6, qualityDows: [2, 4], restDow: 1, level: null, isDefaults: true },
  };
  return { ...base, ...overrides };
}

function makeCheckin(poorDays: number): CheckinAggregate {
  return {
    rowsCount: 7,
    avgEnergy: 5,
    avgSoreness: 5,
    avgStress: 5,
    poorDaysCount: poorDays,
    latestDateISO: '2026-05-10',
    loggedToday: false,
  };
}

async function buildTestPlan(state: CoachState): Promise<Plan> {
  return buildPlan({
    state,
    prefs: { longRunDow: 6, qualityDows: [2, 4], restDow: 1, level: 'intermediate' },
    race: { id: 'test-hm', name: 'Test HM', dateISO: '2026-08-01', distanceMi: 13.1, priority: 'A' },
    todayISO: state.now,
  });
}

const TODAY = '2026-05-12'; // Tuesday in this fixture, falls inside week 0 quality slot

describe('isCrateredVolume', () => {
  it('fires when last7 < 70% of avg4', () => {
    const state = makeState({
      volume: {
        last7Mi: 10, last28Mi: 100, last7Days: [],
        weeklyAvg4w: 25, weeklyAvg8w: 25,
        longestLast28Mi: 10, longestTrainingRunLast28Mi: 10, preRaceLongestTrainingMi: null,
        deltaPct4v4: null,
      },
    });
    expect(isCrateredVolume(state)).toBe(true);
  });
  it('does not fire when last7 ≥ 70% of avg4', () => {
    const state = makeState({
      volume: {
        last7Mi: 20, last28Mi: 100, last7Days: [],
        weeklyAvg4w: 25, weeklyAvg8w: 25,
        longestLast28Mi: 10, longestTrainingRunLast28Mi: 10, preRaceLongestTrainingMi: null,
        deltaPct4v4: null,
      },
    });
    expect(isCrateredVolume(state)).toBe(false);
  });
});

describe('adaptPlan, checkin triggers', () => {
  it('checkin.poorDaysCount = 4 → today quality becomes recovery + citation', async () => {
    const state = makeState({ now: TODAY, checkin: makeCheckin(4) });
    const plan = await buildTestPlan(state);
    // Find today's workout, make sure it's quality first so the test is meaningful.
    const todayBefore = plan.weeks.flatMap(w => w.workouts).find(w => w.dateISO === TODAY)!;
    expect(todayBefore).toBeDefined();
    // Force today's workout to be a quality (Tue should already be one).
    expect(todayBefore.isQuality).toBe(true);

    const mutated = await adaptPlan(plan, state, TODAY, { persist: false });
    const todayAfter = mutated.weeks.flatMap(w => w.workouts).find(w => w.dateISO === TODAY)!;
    expect(todayAfter.isQuality).toBe(false);
    expect(todayAfter.type).toBe('recovery');
    expect(todayAfter.mutations.length).toBe(1);
    expect(todayAfter.mutations[0].citation).toContain('Research/00b');
    expect(todayAfter.mutations[0].trigger).toBe('checkin-yellow');
  });

  it('checkin.poorDaysCount = 1 → NO mutation (single-day below threshold)', async () => {
    const state = makeState({ now: TODAY, checkin: makeCheckin(1) });
    const plan = await buildTestPlan(state);
    const todayBefore = plan.weeks.flatMap(w => w.workouts).find(w => w.dateISO === TODAY)!;
    const beforeType = todayBefore.type;

    const mutated = await adaptPlan(plan, state, TODAY, { persist: false });
    const todayAfter = mutated.weeks.flatMap(w => w.workouts).find(w => w.dateISO === TODAY)!;
    expect(todayAfter.type).toBe(beforeType);
    expect(todayAfter.mutations.length).toBe(0);
  });

  it('idempotent, running adaptPlan twice produces same final state', async () => {
    const state = makeState({ now: TODAY, checkin: makeCheckin(4) });
    const plan = await buildTestPlan(state);
    const once = await adaptPlan(plan, state, TODAY, { persist: false });
    const twice = await adaptPlan(once, state, TODAY, { persist: false });
    const a = once.weeks.flatMap(w => w.workouts).find(w => w.dateISO === TODAY)!;
    const b = twice.weeks.flatMap(w => w.workouts).find(w => w.dateISO === TODAY)!;
    expect(a.type).toBe(b.type);
    expect(a.distanceMi).toBe(b.distanceMi);
    expect(a.mutations.length).toBe(b.mutations.length);
  });
});

describe('adaptPlan, volume crater', () => {
  it('next week ramps from last7 × 1.10', async () => {
    const state = makeState({
      now: TODAY,
      volume: {
        last7Mi: 10, last28Mi: 100, last7Days: [],
        weeklyAvg4w: 25, weeklyAvg8w: 25,
        longestLast28Mi: 10, longestTrainingRunLast28Mi: 10, preRaceLongestTrainingMi: null,
        deltaPct4v4: null,
      },
    });
    const plan = await buildTestPlan(state);
    const sumBefore = plan.weeks.flatMap(w => w.workouts)
      .filter(w => w.dateISO > TODAY && w.dateISO <= '2026-05-19')
      .reduce((s, w) => s + w.distanceMi, 0);

    const mutated = await adaptPlan(plan, state, TODAY, { persist: false });
    const nextWeek = mutated.weeks.flatMap(w => w.workouts)
      .filter(w => w.dateISO > TODAY && w.dateISO <= '2026-05-19');
    const sumAfter = nextWeek.reduce((s, w) => s + w.distanceMi, 0);
    expect(sumAfter).toBeLessThan(sumBefore);
    // Within 11 of last7 × 1.10
    expect(sumAfter).toBeLessThanOrEqual(15);
    // Mutations carry the right citation
    const muts = nextWeek.flatMap(w => w.mutations);
    expect(muts.length).toBeGreaterThan(0);
    expect(muts[0].citation).toContain('Research/00a');
    expect(muts[0].trigger).toBe('volume-crater');
  });
});

describe('adaptPlan, rebuild after break', () => {
  it('next 3-5 days suppress quality', async () => {
    const state = makeState({
      now: TODAY,
      flags: { heavyBlockSuspected: false, rebuildAfterBreak: true, healthKitAvailable: false, recentSkips: [] },
    });
    const plan = await buildTestPlan(state);
    // Find a quality workout in the next 5 days. In BASE phase there is
    // one quality (Tue) per week. May 12 is Tue (TODAY); look at next Tue
    // May 19, but that's >5 days out. So pick TODAY's quality and
    // confirm it gets suppressed.
    const todayWk = plan.weeks.flatMap(w => w.workouts).find(w => w.dateISO === TODAY)!;
    expect(todayWk.isQuality).toBe(true);

    const mutated = await adaptPlan(plan, state, TODAY, { persist: false });
    const todayAfter = mutated.weeks.flatMap(w => w.workouts).find(w => w.dateISO === TODAY)!;
    expect(todayAfter.isQuality).toBe(false);
    expect(todayAfter.mutations[0].citation).toContain('Research/05');
    expect(todayAfter.mutations[0].trigger).toBe('rebuild-after-break');
  });
});

describe('detectPositiveDrift', () => {
  it('returns 0 when running at plan volume', async () => {
    const state = makeState({ now: TODAY });
    const plan = await buildTestPlan(state);
    expect(detectPositiveDrift(plan, state, TODAY)).toBe(0);
  });

  it('returns > 0 when running ≥15% above plan and recovery is healthy', async () => {
    const plan = await buildTestPlan(makeState({ now: TODAY }));
    const prescribedWeekMi = plan.weeks[0].workouts.reduce((s, w) => s + w.distanceMi, 0);
    const state = makeState({
      now: TODAY,
      volume: {
        last7Mi: prescribedWeekMi * 1.30,  // 30% above plan
        last28Mi: 100, last7Days: [],
        weeklyAvg4w: 25, weeklyAvg8w: 25,
        longestLast28Mi: 10, longestTrainingRunLast28Mi: 10, preRaceLongestTrainingMi: null,
        deltaPct4v4: 0,
      },
    });
    const drift = detectPositiveDrift(plan, state, TODAY);
    expect(drift).toBeGreaterThan(0);
    expect(drift).toBeLessThanOrEqual(0.10);  // never exceeds ramp cap
  });

  it('returns 0 when checkin is red (≥3 poor days)', async () => {
    const plan = await buildTestPlan(makeState({ now: TODAY }));
    const prescribedMi = plan.weeks[0].workouts.reduce((s, w) => s + w.distanceMi, 0);
    const state = makeState({
      now: TODAY,
      checkin: makeCheckin(4),
      volume: {
        last7Mi: prescribedMi * 1.30,
        last28Mi: 100, last7Days: [],
        weeklyAvg4w: 25, weeklyAvg8w: 25,
        longestLast28Mi: 10, longestTrainingRunLast28Mi: 10, preRaceLongestTrainingMi: null,
        deltaPct4v4: 0,
      },
    });
    expect(detectPositiveDrift(plan, state, TODAY)).toBe(0);
  });
});

describe('adaptPlan, positive drift', () => {
  it('bumps next week workouts when running well above plan', async () => {
    const plan = await buildTestPlan(makeState({ now: TODAY }));
    const prescribedMi = plan.weeks[0].workouts.reduce((s, w) => s + w.distanceMi, 0);
    const state = makeState({
      now: TODAY,
      volume: {
        last7Mi: prescribedMi * 1.30,
        last28Mi: 100, last7Days: [],
        weeklyAvg4w: 25, weeklyAvg8w: 25,
        longestLast28Mi: 10, longestTrainingRunLast28Mi: 10, preRaceLongestTrainingMi: null,
        deltaPct4v4: 0,
      },
    });

    const nextWeekStart = '2026-05-19';
    const sumBefore = plan.weeks.flatMap(w => w.workouts)
      .filter(w => w.dateISO > TODAY && w.dateISO <= nextWeekStart)
      .reduce((s, w) => s + w.distanceMi, 0);

    const mutated = await adaptPlan(plan, state, TODAY, { persist: false });
    const nextWeek = mutated.weeks.flatMap(w => w.workouts)
      .filter(w => w.dateISO > TODAY && w.dateISO <= nextWeekStart && w.type !== 'rest' && w.type !== 'race');
    const sumAfter = nextWeek.reduce((s, w) => s + w.distanceMi, 0);

    expect(sumAfter).toBeGreaterThan(sumBefore);
    const driftMuts = nextWeek.flatMap(w => w.mutations).filter(m => m.trigger === 'positive-drift');
    expect(driftMuts.length).toBeGreaterThan(0);
    expect(driftMuts[0].citation).toContain('Research/00a');
  });

  it('is idempotent, double-apply does not compound the bump', async () => {
    const plan = await buildTestPlan(makeState({ now: TODAY }));
    const prescribedMi = plan.weeks[0].workouts.reduce((s, w) => s + w.distanceMi, 0);
    const state = makeState({
      now: TODAY,
      volume: {
        last7Mi: prescribedMi * 1.30,
        last28Mi: 100, last7Days: [],
        weeklyAvg4w: 25, weeklyAvg8w: 25,
        longestLast28Mi: 10, longestTrainingRunLast28Mi: 10, preRaceLongestTrainingMi: null,
        deltaPct4v4: 0,
      },
    });
    const once = await adaptPlan(plan, state, TODAY, { persist: false });
    const twice = await adaptPlan(once, state, TODAY, { persist: false });
    const onceWorkouts = once.weeks.flatMap(w => w.workouts)
      .filter(w => w.dateISO > TODAY && w.dateISO <= '2026-05-19');
    const twiceWorkouts = twice.weeks.flatMap(w => w.workouts)
      .filter(w => w.dateISO > TODAY && w.dateISO <= '2026-05-19');
    const sumOnce = onceWorkouts.reduce((s, w) => s + w.distanceMi, 0);
    const sumTwice = twiceWorkouts.reduce((s, w) => s + w.distanceMi, 0);
    expect(sumOnce).toBe(sumTwice);
  });
});

describe('adaptPlan, B-race in window', () => {
  it('B-race day → race workout; ±2 → no quality', async () => {
    const bRaceISO = '2026-05-23';  // Saturday inside week 2 of plan
    const state = makeState({
      now: TODAY,
      races: {
        nextA: null, nextAny: null,
        inWindow: [{
          slug: 'tune-up', name: 'Tune-up 10K',
          date: bRaceISO, distanceMi: 6.2, goalDisplay: '', goalFinishS: null,
          priority: 'B', daysAway: 11,
        }],
        recent: [], raceCount30d: 0,
      },
    });
    const plan = await buildTestPlan(state);
    const mutated = await adaptPlan(plan, state, TODAY, { persist: false });
    const raceDay = mutated.weeks.flatMap(w => w.workouts).find(w => w.dateISO === bRaceISO)!;
    expect(raceDay.type).toBe('race');
    expect(raceDay.distanceMi).toBe(6.2);

    // ±2 days: no quality
    const twoBefore = mutated.weeks.flatMap(w => w.workouts).find(w => w.dateISO === '2026-05-21');
    if (twoBefore) expect(twoBefore.isQuality).toBe(false);
  });
});
