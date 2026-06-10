/**
 * 2026-06-09 · race-killer F3 (splits half) — course-aware goal splits.
 * Fixture = the REAL AFC geometry from course_library.geometry_json
 * (slug americas-finest-city) and the real stored goal (1:30 → 5400s).
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

  it('shapes the race like the course: bank on The Drop, repay on Balboa', () => {
    const byLabel = Object.fromEntries(pacing.phases!.map((p) => [p.label, p.pace_s_per_mi]));
    expect(byLabel['Point Loma Climb']).toBeGreaterThan(FLAT_PACE + 5);  // slower on the climb
    expect(byLabel['The Drop']).toBeLessThan(FLAT_PACE - 10);            // faster on the descent…
    expect(byLabel['The Drop']).toBeGreaterThanOrEqual(FLAT_PACE - 17);  // …but capped ~15 s/mi credit
    expect(byLabel['Balboa Finish']).toBeGreaterThan(FLAT_PACE + 5);     // the sting in the tail priced in
  });

  it('puts the runner ahead of linear splits at 10K (descent banked)', () => {
    const tenK = pacing.splits.find((s) => s.label === '10K')!;
    const linear10K = 6.2137 * FLAT_PACE; // ≈ 42:41
    expect(tenK.cum_sec).toBeLessThan(linear10K - 10);
    expect(tenK.cum_sec).toBeGreaterThan(linear10K - 45);
  });

  it('keeps the 5K split near-linear (climb cost ≈ early-descent credit)', () => {
    const fiveK = pacing.splits.find((s) => s.label === '5K')!;
    expect(Math.abs(fiveK.cum_sec - 3.1069 * FLAT_PACE)).toBeLessThan(20);
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
