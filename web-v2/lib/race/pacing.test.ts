/**
 * 2026-06-09 · race-killer F3 (splits half) — course-aware goal splits.
 * Fixture = the REAL AFC geometry from course_library.geometry_json
 * (slug americas-finest-city) and the real stored goal (1:30 → 5400s).
 *
 * 2026-06-17 · ONE plan — buildRacePacing now lays a negative-split effort
 * arc on top of the terrain pace (NEG_SPLIT_ARC_K = 0.02, ~+2% slower
 * start → ~−2% faster finish, renormalized to the goal). The terrain shape
 * is preserved (climb slow, descent banks) but the front of the race is
 * settled and the close is pushed, so the per-phase paces and the early
 * cumulative splits shift vs the even-effort plan. Assertions below are
 * updated to the merged values; the terrain ordering (climb > goal pace,
 * descent < goal pace, capped credit) is NOT weakened.
 */
import { describe, expect, it } from 'vitest';
import { buildRacePacing } from './pacing';

const AFC_GEOMETRY = {
  facts: { distance_mi: 13.1 },
  phases: [
    { label: 'Point Loma Climb', start_mi: 0, end_mi: 2, expected_gain_ft: 120, expected_mean_grade_pct: 0.8 },
    { label: 'The Drop', start_mi: 2, end_mi: 4.5, expected_loss_ft: 280, expected_mean_grade_pct: -2 },
    { label: 'Mission Bay', start_mi: 4.5, end_mi: 9.9, expected_mean_grade_pct: 0.1 },
    { label: 'Harbor Approach', start_mi: 9.9, end_mi: 10.9, expected_mean_grade_pct: 0.2 },
    // No explicit grade — exercises the gain-derived path (≈ +0.77%).
    { label: 'Balboa Finish', start_mi: 10.9, end_mi: 13.1, expected_gain_ft: 90 },
  ],
};

const GOAL = 5400; // "1:30"
const DIST = 13.1;
const FLAT_PACE = GOAL / DIST; // ≈ 412.2 s/mi

describe('buildRacePacing — AFC 1:30', () => {
  const pacing = buildRacePacing({ goalSec: GOAL, distanceMi: DIST, geometry: AFC_GEOMETRY });

  it('uses the course profile and lands the finish on the goal exactly', () => {
    expect(pacing.source).toBe('course');
    const finish = pacing.splits.find((s) => s.label === 'FINISH')!;
    expect(finish.cum_sec).toBe(GOAL);
    expect(finish.display).toBe('1:30:00');
  });

  it('shapes the race like the course: bank on The Drop, terrain on the climbs', () => {
    const byLabel = Object.fromEntries(pacing.phases!.map((p) => [p.label, p.pace_s_per_mi]));
    // Climb (terrain + the early-settle arc) is the slowest region.
    expect(byLabel['Point Loma Climb']).toBeGreaterThan(FLAT_PACE + 10); // ≈ 429 s/mi
    expect(byLabel['The Drop']).toBeLessThan(FLAT_PACE - 10);            // faster on the descent…  ≈ 400
    expect(byLabel['The Drop']).toBeGreaterThanOrEqual(FLAT_PACE - 17);  // …but capped ~15 s/mi credit
    // Balboa is still terrain-slow (over goal pace) but the closing push
    // ("empty the tank") trims the sting vs the even-effort plan — it now
    // sits between goal pace and FLAT+5, no longer beyond FLAT+5.  ≈ 414
    expect(byLabel['Balboa Finish']).toBeGreaterThan(FLAT_PACE);
    expect(byLabel['Balboa Finish']).toBeLessThan(byLabel['Point Loma Climb']);
  });

  it('carries the negative-split arc: front of race slower than the close', () => {
    const byLabel = Object.fromEntries(pacing.phases!.map((p) => [p.label, p.pace_s_per_mi]));
    // The first phase (settle) runs slower than the final phase (push),
    // even though the final phase is the harder terrain (Balboa climb).
    expect(byLabel['Point Loma Climb']).toBeGreaterThan(byLabel['Balboa Finish']);
  });

  it('tags each phase with its position-based strategy cue', () => {
    const byLabel = Object.fromEntries(pacing.phases!.map((p) => [p.label, p.cue]));
    expect(byLabel['Point Loma Climb']).toBe('Settle in');     // p ≈ 0.08
    expect(byLabel['The Drop']).toBe('Find the rhythm');       // p ≈ 0.25
    expect(byLabel['Mission Bay']).toBe('Lock goal pace');     // p ≈ 0.55
    expect(byLabel['Balboa Finish']).toBe('Empty the tank');   // p ≈ 0.92
  });

  it('keeps the merged plan summing to the goal time', () => {
    // Σ(phaseMi · paceSec) ≈ goalSec — the arc redistributes, the
    // renormalize preserves the average. The published paces are rounded
    // to whole s/mi, so the displayed sum carries a few seconds of
    // per-phase rounding residue across 13.1 mi (the underlying float
    // math sums to the goal exactly — see the FINISH check below).
    const sum = pacing.phases!.reduce(
      (s, p) => s + (p.end_mi - p.start_mi) * p.pace_s_per_mi,
      0,
    );
    expect(Math.abs(sum - GOAL)).toBeLessThan(5); // ~3s rounding on AFC
    // The integrated FINISH checkpoint (unrounded paces) lands on the
    // goal exactly — the renormalize is the guarantee, not the rounding.
    expect(pacing.splits.find((s) => s.label === 'FINISH')!.cum_sec).toBe(GOAL);
  });

  it('settles the early miles: 5K/10K no longer ahead of linear', () => {
    // The even-effort plan banked the descent and was near/ahead of linear
    // by 10K. The arc settles the front, so the early checkpoints sit on or
    // just behind linear (the time comes back over the closing push).
    const linear5K = 3.1069 * FLAT_PACE;
    const linear10K = 6.2137 * FLAT_PACE;
    const fiveK = pacing.splits.find((s) => s.label === '5K')!;
    const tenK = pacing.splits.find((s) => s.label === '10K')!;
    expect(fiveK.cum_sec).toBeGreaterThanOrEqual(Math.round(linear5K)); // ≈ +20s (settled)
    expect(fiveK.cum_sec).toBeLessThan(linear5K + 35);
    expect(Math.abs(tenK.cum_sec - linear10K)).toBeLessThan(15);        // ≈ on linear by 10K
  });

  it('filters checkpoints past the distance (no 30K/40K rungs on a half)', () => {
    expect(pacing.splits.map((s) => s.label)).toEqual(['5K', '10K', 'FINISH']);
  });
});

describe('buildRacePacing — fallbacks', () => {
  it('degrades to linear with no geometry', () => {
    const p = buildRacePacing({ goalSec: GOAL, distanceMi: DIST, geometry: null });
    expect(p.source).toBe('linear');
    expect(p.phases).toBeNull();
    const fiveK = p.splits.find((s) => s.label === '5K')!;
    expect(fiveK.cum_sec).toBe(Math.round(3.1069 * FLAT_PACE));
  });

  it('degrades to linear when phases have gaps (untrustworthy coverage)', () => {
    const gappy = { phases: [{ label: 'A', start_mi: 0, end_mi: 2 }, { label: 'B', start_mi: 5, end_mi: 13.1 }] };
    expect(buildRacePacing({ goalSec: GOAL, distanceMi: DIST, geometry: gappy }).source).toBe('linear');
  });

  it('degrades to linear when phases stop short of the finish', () => {
    const short = { phases: [{ label: 'A', start_mi: 0, end_mi: 8 }] };
    expect(buildRacePacing({ goalSec: GOAL, distanceMi: DIST, geometry: short }).source).toBe('linear');
  });
});
