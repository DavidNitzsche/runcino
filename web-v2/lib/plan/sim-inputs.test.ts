/**
 * Plan-simulator integration smoke · 2026-06-22.
 *
 * Asserts buildSimPlan() feeds the REAL engine valid inputs across all native
 * goal-setup modes (Goal weeks / Race date / Just run) and that each composed
 * plan is sane + VALID. Guards the /api/plan/simulate contract and the
 * byte-stable engine integration.
 */
import { describe, it, expect } from 'vitest';
import { validateComposedPlan } from './validate';
import { buildSimPlan, type SimBuildOk } from './sim-inputs';
import type { SimInputs } from './sim-constants';

const BASE: SimInputs = {
  goalMode: 'goal', distance: 'marathon', startDateISO: '2026-06-22',
  planWeeks: 20, goalTimeSec: 12600,
  raceDateISO: '2026-10-25', lastRaceFinishedDaysAgo: null, lastRaceDistance: null,
  experienceLevel: 'intermediate', weeklyFrequency: 5, weeklyMileageBucket: 25, longestRunBucket: '6-10',
  raceHistory: [], longRunDay: 'sun', availableDays: null,
};

function build(sim: SimInputs): SimBuildOk {
  const r = buildSimPlan(sim);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.reason);
  return r;
}
function validate(r: SimBuildOk) {
  validateComposedPlan(r.composed, r.raceDistanceMi, r.mode, r.validateCtx);
}

describe('plan simulator · engine integration', () => {
  it('GOAL · marathon 20wk → race-prep, 7 days/week, full dow coverage, race week, VALID', () => {
    const r = build(BASE);
    expect(r.mode).toBe('race-prep');
    for (const w of r.composed.weeks) {
      expect(w.days.length).toBe(7);
      expect(new Set(w.days.map((d) => d.dow)).size).toBe(7);
    }
    const last = r.composed.weeks[r.composed.weeks.length - 1];
    expect(last.isRaceWeek).toBe(true);
    expect(last.days.some((d) => d.type === 'race')).toBe(true);
    expect(() => validate(r)).not.toThrow();
  });

  it('GOAL · weeks drive the runway — 16wk plan is shorter than 24wk', () => {
    const w16 = build({ ...BASE, planWeeks: 16 }).composed.totalWeeks;
    const w24 = build({ ...BASE, planWeeks: 24 }).composed.totalWeeks;
    expect(w16).toBeLessThan(w24);
    expect(w16).toBeGreaterThanOrEqual(15);
  });

  it('GOAL · peak exceeds the runner’s recent weekly mileage', () => {
    const r = build(BASE);
    const peak = Math.max(...r.composed.weeks.map((w) => w.weeklyMi));
    expect(peak).toBeGreaterThan(r.derived.recentWeeklyMi);
  });

  it('RACE · a race far past the build window → maintenance', () => {
    const r = build({ ...BASE, goalMode: 'race', raceDateISO: '2027-04-01' });
    expect(r.mode).toBe('maintenance');
    expect(() => validate(r)).not.toThrow();
  });

  it('RACE · a race finished days ago → recovery', () => {
    const r = build({ ...BASE, goalMode: 'race', raceDateISO: '2026-11-15', lastRaceFinishedDaysAgo: 3, lastRaceDistance: 'marathon' });
    expect(r.mode).toBe('recovery');
    expect(() => validate(r)).not.toThrow();
  });

  it('JUST RUN · no goal → maintenance block, VALID', () => {
    const r = build({ ...BASE, goalMode: 'justRun' });
    expect(r.mode).toBe('maintenance');
    expect(r.composed.weeks.length).toBeGreaterThan(0);
    expect(() => validate(r)).not.toThrow();
  });

  it('GOAL · 5k builds a valid race-prep plan', () => {
    const r = build({ ...BASE, distance: '5k', planWeeks: 12, goalTimeSec: 1200, weeklyMileageBucket: 15, longestRunBucket: '3-6' });
    expect(r.mode).toBe('race-prep');
    expect(() => validate(r)).not.toThrow();
  });

  it('GOAL · race history seeds VDOT (best of the entries)', () => {
    const r = build({ ...BASE, raceHistory: [{ distance: 'half', timeSec: 5400, whenRaced: '<6mo' }] }); // 1:30 half
    expect(r.derived.bestRecentVdot).toBeGreaterThan(40);
  });

  it('true beginner · freq 3 caps running days at ≤3 every week', () => {
    const r = build({ ...BASE, distance: 'half', planWeeks: 16, goalTimeSec: null, experienceLevel: 'beginner', weeklyFrequency: 3, weeklyMileageBucket: 5, longestRunBucket: '0-3' });
    expect(r.derived.trainingDaysPerWeek).toBe(3);
    for (const w of r.composed.weeks) {
      expect(w.days.filter((d) => d.type !== 'rest' && d.distanceMi > 0).length).toBeLessThanOrEqual(3);
    }
  });

  it('RACE · a race under 2 weeks out is rejected with a friendly reason', () => {
    const r = buildSimPlan({ ...BASE, goalMode: 'race', raceDateISO: '2026-06-28' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/2 weeks/i);
  });
});
