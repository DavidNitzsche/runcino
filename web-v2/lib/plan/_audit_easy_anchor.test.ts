/**
 * PACE-E-1 guard — easy/long/recovery anchor to CURRENT fitness (easyAnchorTSec), quality stays on
 * the goal-blended tPaceSec, and a null anchor is byte-identical (the safe default).
 */
import { describe, it, expect } from 'vitest';
import { buildWorkoutSpec } from './spec-builder';

const goalT = 400;     // fast goal-blended T
const currentT = 460;  // slower current fitness (sub-fitness goal)

describe('PACE-E-1 · easy anchor', () => {
  it('easy day anchors to currentT when threaded (slower than the goal-blend)', () => {
    const anchored = buildWorkoutSpec('easy', 6, goalT, null, null, null, null, null, currentT).spec as any;
    const def = buildWorkoutSpec('easy', 6, goalT, null, null, null, null, null, null).spec as any;
    // anchored easy floor = currentT+80 (slower/higher) > default goalT+80
    expect(anchored.pace_target_s_per_mi_lo).toBeGreaterThan(def.pace_target_s_per_mi_lo);
    expect(anchored.pace_target_s_per_mi_lo).toBe(currentT + 80);
    expect(def.pace_target_s_per_mi_lo).toBe(goalT + 80);
  });

  it('null anchor is byte-identical to the prior behavior', () => {
    const a = buildWorkoutSpec('long', 12, goalT, null, null, null, null, null, null);
    const b = buildWorkoutSpec('long', 12, goalT, null, null, null, null, null);  // arg omitted
    expect(a).toEqual(b);
  });

  it('quality (threshold) ignores the anchor — stays on the goal-blended tPaceSec', () => {
    const anchored = buildWorkoutSpec('threshold', 5, goalT, null, null, null, null, null, currentT);
    const noAnchor = buildWorkoutSpec('threshold', 5, goalT, null, null, null, null, null, null);
    expect(anchored).toEqual(noAnchor);
  });
});
