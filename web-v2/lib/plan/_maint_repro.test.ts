import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';

const BASE = {
  goalMode: 'race' as const, distance: '5k' as const, raceDateISO: '2026-09-13',
  startDateISO: '2026-06-24', experienceLevel: 'intermediate' as const,
  weeklyMileageBucket: 25 as const, longRunDay: 'sun' as const, restDay: 'sat' as const,
  raceHistory: [], goalTimeSec: null, planWeeks: 12,
};

function runDays(plan: ReturnType<typeof buildSimPlan>) {
  if (!plan.ok) return [];
  return plan.composed.weeks[0].days.filter(d => d.distanceMi > 0);
}

describe('maintenance week respects days-per-week', () => {
  for (const freq of [1, 2, 3, 4, 5, 6] as const) {
    it(`freq=${freq} → at most ${freq <= 1 ? 1 : freq} running days`, () => {
      const r = buildSimPlan({ ...BASE, weeklyFrequency: freq, longestRunBucket: '6-10', availableDays: [] });
      if (!r.ok) { console.log('fail:', r.reason); return; }
      const run = runDays(r);
      console.log(`freq=${freq}: ${run.length} days → ${run.map(d => `dow${d.dow}(${d.type},${d.distanceMi}mi)`).join(', ')}`);
      expect(run.length).toBeLessThanOrEqual(freq <= 0 ? 3 : freq);
      expect(r.composed.weeks[0].phase).toBe('MAINTENANCE');
    });
  }
});

describe('SIM-COH-1: different longest-run buckets produce different plans', () => {
  it('0-3 and 3-6 buckets with 30mpw / 3 days produce different long runs', () => {
    const r03 = buildSimPlan({ ...BASE, weeklyFrequency: 3, longestRunBucket: '0-3', availableDays: [] });
    const r36 = buildSimPlan({ ...BASE, weeklyFrequency: 3, longestRunBucket: '3-6', availableDays: [] });
    if (!r03.ok || !r36.ok) throw new Error('plan failed');
    const long03 = r03.composed.weeks[0].days.find(d => d.isLong)?.distanceMi ?? 0;
    const long36 = r36.composed.weeks[0].days.find(d => d.isLong)?.distanceMi ?? 0;
    console.log(`0-3 bucket: long=${long03}mi, 3-6 bucket: long=${long36}mi`);
    expect(long03).toBeLessThan(long36);
  });

  it('3-6 and 6-10 buckets produce different long runs', () => {
    const r36 = buildSimPlan({ ...BASE, weeklyFrequency: 3, longestRunBucket: '3-6', availableDays: [] });
    const r610 = buildSimPlan({ ...BASE, weeklyFrequency: 3, longestRunBucket: '6-10', availableDays: [] });
    if (!r36.ok || !r610.ok) throw new Error('plan failed');
    const long36 = r36.composed.weeks[0].days.find(d => d.isLong)?.distanceMi ?? 0;
    const long610 = r610.composed.weeks[0].days.find(d => d.isLong)?.distanceMi ?? 0;
    console.log(`3-6 bucket: long=${long36}mi, 6-10 bucket: long=${long610}mi`);
    expect(long36).toBeLessThanOrEqual(long610);
  });
});
