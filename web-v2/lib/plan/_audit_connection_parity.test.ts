/**
 * CC-2 guard — cold-start and Strava-connected validation AGREE for the same runner.
 * A bucket-0 (3mpw) marathon is infeasible; it must be refused IDENTICALLY whether or not Strava is
 * connected (it used to pass cold then vanish on connect). A feasible base must pass in both.
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';
import { validateComposedPlan, PlanValidationError } from './validate';

const base = {
  startDateISO: '2026-07-06', raceDateISO: '', lastRaceFinishedDaysAgo: 0, lastRaceDistance: null,
  raceHistory: [], longRunDay: 'sun', availableDays: [], goalMode: 'goal',
} as any;

function outcome(a: any, trailing: number | null): boolean {
  const r = buildSimPlan(a);
  if (!r.ok) return false;
  try { validateComposedPlan(r.composed, r.raceDistanceMi, r.mode, { ...r.validateCtx, trailingAvgWeeklyMi: trailing }); return true; }
  catch (e) { if (e instanceof PlanValidationError) return false; throw e; }
}

describe('CC-2 · cold/Strava connection parity', () => {
  it('bucket-0 marathon is refused identically cold and Strava (no vanish-on-connect)', () => {
    const a = { ...base, distance: 'marathon', planWeeks: 18, goalTimeSec: 13500, experienceLevel: 'beginner', weeklyFrequency: 3, weeklyMileageBucket: 0, longestRunBucket: '0-3' };
    const wk = buildSimPlan(a).ok ? (buildSimPlan(a) as any).derived.recentWeeklyMi : 0;
    expect(outcome(a, null)).toBe(outcome(a, wk)); // cold === strava
  });

  it('a feasible base validates in both connection states', () => {
    const a = { ...base, distance: 'marathon', planWeeks: 18, goalTimeSec: 13500, experienceLevel: 'intermediate', weeklyFrequency: 5, weeklyMileageBucket: 25, longestRunBucket: '6-10' };
    const wk = (buildSimPlan(a) as any).derived.recentWeeklyMi;
    expect(outcome(a, null)).toBe(true);
    expect(outcome(a, wk)).toBe(true);
  });
});
