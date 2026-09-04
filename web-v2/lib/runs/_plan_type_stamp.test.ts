import { describe, expect, it } from 'vitest';
import { distanceMatchesPlan } from './plan-type-stamp';

/**
 * OVERRUN-MATCH-1 · falsifies the exact regression this band exists to
 * prevent (Rule 18: a gate is not trusted until it has been made to fail).
 * The live incident: a 4.5 mi EASY prescription, 6.18 mi actually run
 * (+37.3%) — the old symmetric ±30% band refused this, this test locks in
 * that it must not refuse it again.
 */
describe('distanceMatchesPlan · OVERRUN-MATCH-1', () => {
  it('matches David\'s own 2026-08-31 run: 4.5 mi prescribed, 6.18 mi actual', () => {
    expect(distanceMatchesPlan(6.18, 4.5)).toBe(true);
  });

  it('still refuses a materially SHORT run — a bail is a different session', () => {
    // 4.5 * 0.7 = 3.15; 3.0 is short of the floor.
    expect(distanceMatchesPlan(3.0, 4.5)).toBe(false);
  });

  it('accepts a run right at the floor', () => {
    expect(distanceMatchesPlan(4.5 * 0.7, 4.5)).toBe(true);
  });

  it('accepts a run right at the new, doubled ceiling', () => {
    expect(distanceMatchesPlan(4.5 * 2.0, 4.5)).toBe(true);
  });

  it('still refuses a wildly unrelated, much longer effort on the same day', () => {
    // A marathon on a 4.5 mi easy day must not inherit "easy".
    expect(distanceMatchesPlan(26.2, 4.5)).toBe(false);
  });

  it('the old, pre-fix symmetric ±30% ceiling would have refused this — proving the fix actually moved the boundary', () => {
    const oldCeiling = 4.5 * 1.3; // 5.85
    expect(6.18).toBeGreaterThan(oldCeiling);
    expect(distanceMatchesPlan(6.18, 4.5)).toBe(true);
  });

  it('treats a missing or non-positive prescription distance as always matching', () => {
    expect(distanceMatchesPlan(6.18, null)).toBe(true);
    expect(distanceMatchesPlan(6.18, 0)).toBe(true);
  });
});
