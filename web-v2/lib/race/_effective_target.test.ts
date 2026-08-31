/**
 * EFFECTIVE-RACE-TARGET INVARIANTS (2026-08-17 · coaching-loop
 * reconciliation).
 *
 * The one rule every race pacing surface (watch payload, execution plan,
 * race-detail splits) now obeys: never prescribe paces more than 5%
 * faster than the current projection. Goal within 5% → goal; goal
 * fantasy → projection (rounded); no snapshot → goal fallback.
 *
 * Cite: Research/08-pacing-and-race-week.md §18.2.
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_GOAL_OPTIMISM_FRACTION,
  roundTargetSec,
  prescriptionFloorSec,
  resolveEffectiveRaceTarget,
} from './effective-race-target';

describe('resolveEffectiveRaceTarget', () => {
  it('no projection snapshot → goal fallback', () => {
    const r = resolveEffectiveRaceTarget(10800, null);
    expect(r.targetSec).toBe(10800);
    expect(r.source).toBe('goal');
    expect(r.projectionSec).toBeNull();
  });

  it('goal within 5% of projection → goal (the push is allowed)', () => {
    // 3:00 goal · projection 3:07 (11220). 5% floor = 10659 → goal stands.
    const r = resolveEffectiveRaceTarget(10800, 11220);
    expect(r.source).toBe('goal');
    expect(r.targetSec).toBe(10800);
    expect(r.projectionSec).toBe(11220);
  });

  it('exact 5% boundary still honors the goal', () => {
    const proj = 12000;
    const goal = Math.ceil(proj * (1 - MAX_GOAL_OPTIMISM_FRACTION)); // 11400
    const r = resolveEffectiveRaceTarget(goal, proj);
    expect(r.source).toBe('goal');
  });

  it('goal fantasy (>5% faster than projection) → the band EDGE, goal demoted to stretch', () => {
    // The CIM scenario: goal 3:00 (10800), projection at VDOT 44.1 ≈ 3:22
    // (12120). 10800 < 12120*0.95 = 11514 → the goal is beyond the band.
    //
    // 2026-08-30 · Rule 9. This used to assert `roundTargetSec(12120)` — the
    // UNREDUCED projection — which is the cliff: a runner whose goal sat one
    // second inside the band was raced at his goal (up to 5% faster than the
    // projection), and a runner one second outside it was thrown all the way
    // back to the projection, 606 s slower. The band's edge is the bound, so a
    // goal past it clamps TO the edge. The assertion below it is the one that
    // never changed, and it is what keeps this honest.
    const r = resolveEffectiveRaceTarget(10800, 12120);
    expect(r.source).toBe('projection');
    expect(r.targetSec).toBe(prescriptionFloorSec(12120, MAX_GOAL_OPTIMISM_FRACTION));
    expect(r.targetSec).toBe(11520);
    expect(r.goalSec).toBe(10800);            // the stretch rides along
    // The rule itself: target is never >5% faster than projection.
    expect(r.targetSec).toBeGreaterThanOrEqual(12120 * 0.95);
  });

  it('a garbage projection (0 / NaN) degrades to the goal', () => {
    expect(resolveEffectiveRaceTarget(5400, 0).source).toBe('goal');
    expect(resolveEffectiveRaceTarget(5400, Number.NaN).source).toBe('goal');
  });
});

describe('roundTargetSec', () => {
  it('rounds to 10s over an hour, 5s under', () => {
    expect(roundTargetSec(11647)).toBe(11650);
    expect(roundTargetSec(11644)).toBe(11640);
    expect(roundTargetSec(1123)).toBe(1125);
    expect(roundTargetSec(1121)).toBe(1120);
  });
});
