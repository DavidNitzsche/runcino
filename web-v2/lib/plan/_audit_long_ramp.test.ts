/**
 * A1 long-run-ramp guard (third deep audit, 2026-06-23).
 *
 * The marathon/ultra long must climb GRADUALLY to the doctrine peak (Research/22:228), not
 * saturate the cap by BASE week 2. Before A1, recentLong≥12 produced [14,17,19,16,19,19,19,...]
 * — parked at 19 from week 2, with a 117%-of-recent week-1 long (Research/00a:752 injury rule).
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';

const base = {
  startDateISO: '2026-07-06', raceDateISO: '', lastRaceFinishedDaysAgo: 0, lastRaceDistance: null,
  raceHistory: [], longRunDay: 'sun', availableDays: [], weeklyFrequency: 5,
} as any;

const buildLongs = (longestRunBucket: string, bucket: number) => {
  const r = buildSimPlan({ ...base, goalMode: 'goal', distance: 'marathon', planWeeks: 18,
    goalTimeSec: 12600, experienceLevel: 'beginner', weeklyMileageBucket: bucket, longestRunBucket });
  if (!r.ok) throw new Error(r.reason);
  return r.composed.weeks.map((w: any) => {
    const l = w.days.find((d: any) => d.isLong && d.type !== 'race');
    return l ? Math.round(l.distanceMi) : 0;
  });
};

describe('A1 · long-run ramp shape', () => {
  it('recent long 12 → gradual climb, no early plateau, week-1 ≤110%', () => {
    const longs = buildLongs('10+', 35);
    expect(longs[0]).toBeLessThanOrEqual(13);       // week-0 ≤110% of recent 12 (was 14 = 117%)
    expect(longs[2]).toBeLessThanOrEqual(17);        // not parked at 19 by week 2
    expect(Math.max(...longs)).toBeGreaterThanOrEqual(20); // still reaches the doctrine peak
    // no climb into NEW territory bigger than +3mi (≈10% at these magnitudes). A rebound after a
    // cutback dip is allowed even when the raw step >3 — RC2-4 (returning from a planned cutback is
    // an expected jump, not a ramp error). So compare each new high against the PRIOR PEAK, not the
    // immediate prior week: a dip-then-recover (18→15→19) is a +1 climb over the established 18,
    // expressed as a +4 step only because of the intervening cutback. A genuine early-saturation
    // jump (the bug this guards) still trips it, and longs[0]/longs[2] above pin the early weeks.
    const build = longs.slice(0, 13);
    let priorMax = build[0];
    for (let i = 1; i < build.length; i++) {
      if (build[i] > priorMax) {
        expect(build[i] - priorMax).toBeLessThanOrEqual(3);
        priorMax = build[i];
      }
    }
  });

  it('recent long 5 → gradual climb from the runner capacity, reaches the peak late', () => {
    const longs = buildLongs('3-6', 25);
    expect(longs[0]).toBeLessThanOrEqual(7);         // seeded near recent 5
    expect(Math.max(...longs)).toBeGreaterThanOrEqual(18);
    // the peak arrives in the back half, not week 2
    const peakIdx = longs.indexOf(Math.max(...longs));
    expect(peakIdx).toBeGreaterThan(8);
  });
});
