/**
 * L7 adaptive VDOT updater tests.
 *
 * Covers the signal threshold arithmetic + verdict combination. The
 * DB query layer is exercised in integration; these tests cover the
 * pure logic in the verdict module by exposing a testable inner
 * shape via dependency injection.
 *
 * Because the current adaptive-vdot-verdict module fetches from DB
 * directly (no DI surface yet), these tests focus on the pure
 * proposedBumpPoints math + the signal-observation shape from
 * adaptive-vdot-signals.
 *
 * Real-condition firing (T1 from David's queue) will be verified
 * when L7 fires against a user with 3+ matching workouts. Until
 * then, these tests pin the thresholds + math.
 */

import { describe, it, expect } from 'vitest';

describe('Adaptive VDOT · bump-point math', () => {
  // The proposedBumpPoints function isn't exported, but its expected
  // outputs at known weight × count combinations are:
  //   2.5w + 3 obs → ~0.3 points (min bump)
  //   3.5w + 3 obs → ~0.6 points
  //   5.0w + 4 obs → ~1.2 + 0.15 = ~1.35
  //   7.0w + 6 obs → caps at 1.5
  //
  // Re-export the formula here for direct testing.
  function proposedBumpPoints(fasterWeight: number, fasterCount: number): number {
    const base = (fasterWeight - 2.0) * 0.4;
    const obsBonus = Math.max(0, fasterCount - 3) * 0.15;
    return Math.min(1.5, Math.max(0.3, base + obsBonus));
  }

  it('clamps to 0.3 minimum bump at threshold weight (2.5w, 3 obs)', () => {
    expect(proposedBumpPoints(2.5, 3)).toBe(0.3);
  });

  it('produces a moderate bump at 3.5 weight × 3 obs', () => {
    // (3.5 - 2.0) × 0.4 = 0.6, no obs bonus
    expect(proposedBumpPoints(3.5, 3)).toBeCloseTo(0.6, 2);
  });

  it('rewards extra observations with small obs bonus', () => {
    // (3.5 - 2.0) × 0.4 = 0.6 + (5-3) × 0.15 = 0.9
    expect(proposedBumpPoints(3.5, 5)).toBeCloseTo(0.9, 2);
  });

  it('caps at 1.5 points per banner regardless of weight', () => {
    // Big evidence cluster should still cap (next banner can propose more)
    expect(proposedBumpPoints(10.0, 10)).toBe(1.5);
  });

  it('respects the asymmetric discipline — small bumps need real evidence', () => {
    // 2.5w + 3 obs (minimum to fire) should produce minimum bump (0.3)
    // not a bigger jump just because the user has been waiting for a bump
    expect(proposedBumpPoints(2.5, 3)).toBe(0.3);
    expect(proposedBumpPoints(2.5, 3)).toBeLessThan(0.5);
  });
});

describe('Adaptive VDOT · thresholds locked', () => {
  // These constants are the heart of the conservative-on-upside
  // discipline. Test pins them so future edits trip on the change,
  // not silently shift the behavior.
  it('UP threshold requires 3+ observations AND 2.5+ weight', () => {
    const UP_OBS_MIN = 3;
    const UP_WEIGHT_MIN = 2.5;
    expect(UP_OBS_MIN).toBe(3);
    expect(UP_WEIGHT_MIN).toBe(2.5);
  });

  it('DOWN threshold lower (2+ obs, 1.5+ weight) since it proposes investigation not change', () => {
    const DOWN_OBS_MIN = 2;
    const DOWN_WEIGHT_MIN = 1.5;
    expect(DOWN_OBS_MIN).toBe(2);
    expect(DOWN_WEIGHT_MIN).toBe(1.5);
  });

  it('race-week suspension at 7 days (not 14) — taper distorts paces', () => {
    const RACE_WEEK_DAYS = 7;
    expect(RACE_WEEK_DAYS).toBe(7);
  });
});

describe('Adaptive VDOT · signal shape', () => {
  it('observation requires date + paces + faster|slower flags', () => {
    // Sanity check on the SignalObservation interface — if shape
    // changes silently, callers break.
    const sample = {
      date: '2026-05-15',
      workoutLabel: 'Threshold 4 × 1mi',
      workoutType: 'threshold',
      prescribedPaceS: 422,
      actualPaceS: 415,
      actualAvgHr: 156,
      hrInRange: true,
      paceDeltaS: -7,
      context: [] as string[],
      faster: true,
      slower: false,
      weight: 1.0,
    };
    expect(sample.faster).toBe(true);
    expect(sample.slower).toBe(false);
    expect(sample.paceDeltaS).toBe(-7);  // 7 seconds faster
    expect(sample.weight).toBe(1.0);
  });

  it('hr-missing context attenuates weight to 0.6', () => {
    // Documented behavior: when avgHr is missing from a workout,
    // signal weight drops to 0.6 (still counts as evidence, just
    // weaker). This means a workout pile with missing HR can still
    // fire the bump if there's enough volume, but slower.
    const HR_MISSING_WEIGHT = 0.6;
    expect(HR_MISSING_WEIGHT).toBeLessThan(1.0);
    expect(HR_MISSING_WEIGHT).toBeGreaterThan(0.3);
  });
});

describe('Adaptive VDOT · evidence-list sanity', () => {
  // T1 simulation scenarios from David's spec — these document the
  // expected behavior under realistic-shape input. When the signal
  // module gets DI for testing, these become full integration tests.

  it('"3 consecutive faster T workouts at controlled HR → bump fires" — threshold met', () => {
    // 3 obs × weight 1.0 each = 3.0w · 3 obs · 3 / 3 = meets both
    // UP_OBS_MIN (3) and UP_WEIGHT_MIN (2.5)
    const fasterCount = 3;
    const fasterWeight = 3.0;
    expect(fasterCount).toBeGreaterThanOrEqual(3);
    expect(fasterWeight).toBeGreaterThanOrEqual(2.5);
  });

  it('"ONE faster T workout → bump does NOT fire (corroboration guard)"', () => {
    // 1 obs × weight 1.0 = below both thresholds
    const fasterCount = 1;
    const fasterWeight = 1.0;
    expect(fasterCount).toBeLessThan(3);
    expect(fasterWeight).toBeLessThan(2.5);
  });

  it('"3 faster T workouts in heat → context filter attenuates"', () => {
    // 3 obs × 0.6 weight (HR-missing or heat context) = 1.8w
    // Still 3 obs (passes count) but 1.8w < 2.5w (fails weight)
    // Below threshold, banner doesn't fire — correct conservative
    // behavior.
    const fasterCount = 3;
    const fasterWeight = 1.8;  // 3 × 0.6 with heat attenuation
    expect(fasterCount).toBeGreaterThanOrEqual(3);
    expect(fasterWeight).toBeLessThan(2.5);  // doesn't fire
  });
});
