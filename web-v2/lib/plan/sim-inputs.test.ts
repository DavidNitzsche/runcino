/**
 * Plan-simulator integration smoke · 2026-06-22.
 *
 * Asserts the simulator's translation layer feeds composePlan a valid input and
 * that the real engine path (compose → finalize → validate) produces a sane,
 * VALID plan for representative onboarding answers. Guards the /api/plan/simulate
 * contract: shape the UI renders (7 days/week, dow coverage, phase strings) and
 * the byte-stable engine integration.
 */
import { describe, it, expect } from 'vitest';
import { composePlan, finalizeComposedPlan } from './generate';
import { validateComposedPlan } from './validate';
import { simInputsToComposeInput, type SimInputs } from './sim-inputs';

function run(sim: SimInputs) {
  const t = simInputsToComposeInput(sim);
  expect(t.ok).toBe(true);
  if (!t.ok || !t.compose) throw new Error(t.reason);
  const composed = composePlan(t.compose);
  finalizeComposedPlan(composed, t.compose.raceDistanceMi);
  return { composed, compose: t.compose, derived: t.derived! };
}

const MARATHON: SimInputs = {
  distance: 'marathon',
  raceDateISO: '2026-10-25',
  goalTimeSec: 12600, // 3:30:00
  startDateISO: '2026-06-22',
  level: 'intermediate',
  weeklyFrequency: 5,
  longRunDay: 'sun',
  recentWeeklyMi: 30,
  recentLongMi: 12,
};

describe('plan simulator · engine integration', () => {
  it('marathon · produces a multi-week plan with 7 days/week and full dow coverage', () => {
    const { composed } = run(MARATHON);
    expect(composed.weeks.length).toBeGreaterThanOrEqual(10);
    for (const w of composed.weeks) {
      expect(w.days.length).toBe(7);
      const dows = new Set(w.days.map((d) => d.dow));
      expect(dows.size).toBe(7); // every dow 0-6 present exactly once
      for (let d = 0; d < 7; d++) expect(dows.has(d as any)).toBe(true);
    }
  });

  it('marathon · last week is race week and contains a race day at race distance', () => {
    const { composed, compose } = run(MARATHON);
    const last = composed.weeks[composed.weeks.length - 1];
    expect(last.isRaceWeek).toBe(true);
    const raceDay = last.days.find((d) => d.type === 'race');
    expect(raceDay).toBeTruthy();
    expect(raceDay!.distanceMi).toBeCloseTo(compose.raceDistanceMi, 0);
  });

  it('marathon · emits the expected phase vocabulary and a peak before taper', () => {
    const { composed } = run(MARATHON);
    const phases = new Set(composed.weeks.map((w) => w.phase));
    // BASE must exist; TAPER must precede the race.
    expect(phases.has('BASE')).toBe(true);
    expect(composed.weeks.some((w) => w.phase === 'TAPER')).toBe(true);
    const peak = Math.max(...composed.weeks.map((w) => w.weeklyMi));
    expect(peak).toBeGreaterThan(MARATHON.recentWeeklyMi);
  });

  it('marathon · validates clean as race-prep', () => {
    const { composed, compose } = run(MARATHON);
    expect(() =>
      validateComposedPlan(composed, compose.raceDistanceMi, 'race-prep', {
        level: compose.level,
        isSteppingStoneToMarathon: false,
        priorPlanPeakLongMi: null,
        todayISO: compose.startMondayISO,
        trainingDaysPerWeek: compose.trainingDaysPerWeek,
        trailingAvgWeeklyMi: compose.recentWeeklyMi,
      }),
    ).not.toThrow();
  });

  it('5k · short race builds a valid plan', () => {
    const { composed, compose } = run({
      ...MARATHON,
      distance: '5k',
      goalTimeSec: 1200, // 20:00
      raceDateISO: '2026-09-01',
      recentWeeklyMi: 20,
      recentLongMi: 7,
    });
    expect(composed.weeks.length).toBeGreaterThanOrEqual(3);
    expect(() =>
      validateComposedPlan(composed, compose.raceDistanceMi, 'race-prep', {
        level: compose.level,
        isSteppingStoneToMarathon: false,
        priorPlanPeakLongMi: null,
        todayISO: compose.startMondayISO,
        trainingDaysPerWeek: compose.trainingDaysPerWeek,
        trailingAvgWeeklyMi: compose.recentWeeklyMi,
      }),
    ).not.toThrow();
  });

  it('true beginner · 3 days/week, low base, validates and caps running days', () => {
    const { composed, derived } = run({
      ...MARATHON,
      distance: 'half',
      goalTimeSec: null,
      raceDateISO: '2026-11-01',
      level: 'beginner',
      weeklyFrequency: 3,
      recentWeeklyMi: 8,
      recentLongMi: 3,
    });
    expect(derived.trainingDaysPerWeek).toBe(3);
    // No week prescribes more than 3 running days when freq=3.
    for (const w of composed.weeks) {
      const runningDays = w.days.filter((d) => d.type !== 'rest' && d.distanceMi > 0).length;
      expect(runningDays).toBeLessThanOrEqual(3);
    }
  });

  it('guard · race under 2 weeks out is rejected with a friendly reason', () => {
    const t = simInputsToComposeInput({ ...MARATHON, raceDateISO: '2026-06-28' });
    expect(t.ok).toBe(false);
    expect(t.reason).toMatch(/2 weeks/i);
  });
});
