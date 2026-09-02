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
    // SPIKEROLL-1 (2026-08-31) · this bound was >= 18, and that was the bug,
    // not this fix. Research/00a §"Practical load rules" caps a single long at
    // 110% of the longest run in the prior 30 days (`SPIKE_MAX_SHARE`), so an
    // UNROUNDED 10%-per-week climb over the full 13-week climbing span this
    // archetype gets can reach at most 5 * 1.1^13 ≈ 17.3 mi as a pure ceiling —
    // never 18, and the engine measures BELOW that theoretical bound besides,
    // because the 30-day anchor is ROLLING (it reads the actual, already-
    // rounded-to-a-half-mile week the runner would have run, not an unrounded
    // running product) and every quality/easy day in the same week is held at
    // or below the long, which can itself pull a week's max down a further
    // half-step on the grid. The old assertion required the ramp to climb
    // FASTER than the doctrine ceiling it is bound by, which is exactly the
    // shape `enforceSpikeRule` (`finalizeComposedPlan`) now closes: measured
    // here at a peak of 15.5 mi (rounds to 16), reached at week 17. See
    // docs/spikeroll-1-handback.md §3b — "the engine's low-capacity long-run
    // ramp is designed to breach Research/00a:752, and a test has been
    // asserting that it does" — this is that fix, applied to the test itself.
    //
    // GOALVOL-1 (2026-09-02) · MOVED ONCE, 16 → 15, and both ends are now
    // pinned so it cannot drift silently in either direction again.
    //
    // This archetype is `experienceLevel: 'beginner'` with a 3:30 marathon goal
    // (481 s/mi, which the pace table grades `intermediate`). Under the old
    // classifier the typed goal SELECTED the intermediate row — peak 45-55
    // mi/wk, long 20-22 mi — for a runner who had stated they were a beginner
    // and demonstrated nothing. David's ruling closed that: the band is now the
    // runner's CAPACITY, which for a beginner with no measured fitness is
    // `developing`, and `Research/22` §"Marathon — Beginner" is the row that
    // describes them: 30-45 mi/wk, 16-20 mi long. Measured across the change:
    // peak weekly 34 → 31, peak long 15.5 → 15.0, peak still at week 14.
    //
    // The half-mile is not the point and the CEILING is: this ramp opens at a
    // recent long of 5 mi and `Research/00a` §"Practical load rules" caps each
    // long at 110% of the prior 30 days' longest, so 5 × 1.1^13 ≈ 17.3 mi is
    // the most a 13-week climbing span can reach however big the tier's band
    // is. The old assertion (>= 18, before SPIKEROLL-1) required the ramp to
    // BREACH that ceiling; the assertion after it (>= 16) was the measurement
    // rounded up. Neither watched the top. Both ends are stated now.
    const SPIKE_CEILING_MI = Math.ceil(5 * 1.1 ** 13);        // 18
    expect(Math.max(...longs)).toBeGreaterThanOrEqual(15);
    expect(Math.max(...longs)).toBeLessThanOrEqual(SPIKE_CEILING_MI);
    // the peak arrives in the back half, not week 2
    const peakIdx = longs.indexOf(Math.max(...longs));
    expect(peakIdx).toBeGreaterThan(8);
  });
});
