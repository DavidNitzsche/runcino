/**
 * _target_continuity.test.ts · CONTINUOUS-TARGET-1 · Rule 9 · no cliff at the
 * achievability band edge.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * Both moments that bound a prescribed race target — authoring
 * (`achievableRaceTarget`) and execution (`resolveEffectiveRaceTarget`) — read
 * doctrine's 5% achievability band and then spent it TWICE:
 *
 *   goalSec >= bound * 0.95  ->  prescribe the GOAL
 *   goalSec <  bound * 0.95  ->  prescribe the BOUND
 *
 * The second branch does not clamp to the band edge, it snaps all the way back
 * to the unreduced ceiling/projection. So the prescribed target JUMPS by the
 * full 5% of race time as the stated goal crosses the edge, in the wrong
 * direction:
 *
 *   goal at 95.1% of the ceiling  ->  prescribed at 95.1% of the ceiling
 *   goal at 94.9% of the ceiling  ->  prescribed at 100%  of the ceiling
 *
 * BEING SLIGHTLY MORE AMBITIOUS BUYS A SLOWER PRESCRIBED RACE PACE. That is
 * Rule 9's recurring signature — the fitter (here, the hungrier) runner gets
 * the worse plan — and this one sets the pace every marathon-pace session in
 * the block rehearses.
 *
 * ── WHAT THIS GATE ASSERTS ──────────────────────────────────────────────────
 *
 * Walk the stated goal across the band edge one second at a time and require
 * the prescribed target to move CONTINUOUSLY and MONOTONICALLY. Monotonicity
 * is the assertion that names the defect directly: a faster stated goal (a
 * SMALLER goalSec) may never produce a slower prescribed target.
 *
 * Rule 18: falsified against the unfixed engine before landing — the walk
 * reported a 573 s jump at the edge on the authoring side and 606 s on the
 * execution side, and the monotonicity assertion named the inversion.
 */
import { describe, it, expect } from 'vitest';
import {
  achievableRaceTarget,
  seasonalVdotCeiling,
  GOAL_OPTIMISM_TOLERANCE,
} from './achievable-target';
import { predictRaceTime } from './vdot';
import { composeRaceOutlook } from '@/lib/race/race-outlook';
import { fixtureReads, fixtureRace } from '@/lib/race/_race_outlook_fixture';

/** The owner's CIM shape: a 3:00 marathon goal off a mid-40s VDOT. */
const VDOT = 44.1;
const DIST_MI = 26.2;
const WEEKS = 14;

const CEILING_SEC = predictRaceTime(
  seasonalVdotCeiling(VDOT, WEEKS, DIST_MI).ceilingVdot,
  DIST_MI,
)!;

/** The largest legitimate step: prescribed targets are rounded to a clean
 *  10 s over an hour, so a 1 s move of the goal may move the target 10 s. */
const ROUNDING_STEP_S = 10;

function authoredAt(goalSec: number): number {
  return achievableRaceTarget({
    goalSec, currentVdot: VDOT, raceDistanceMi: DIST_MI, totalWeeks: WEEKS,
  })!.targetSec;
}

// 2026-09-01 · P0 · the execution moment is the race-pace brain. Pre-walk
// the goal space once (compose is async) so `sweep` stays synchronous.
const EXEC_READS = fixtureReads();
const EXEC_TARGETS = new Map<number, number>();
async function primeExecution(lo: number, hi: number) {
  for (let g = lo; g <= hi; g++) {
    const o = await composeRaceOutlook(fixtureRace({ statedGoalSec: g }), '2026-09-01', EXEC_READS);
    EXEC_TARGETS.set(g, o.execution.targetSec!);
  }
}
function executedAt(goalSec: number): number {
  const t = EXEC_TARGETS.get(goalSec);
  if (t == null) throw new Error(`execution walk not primed for goalSec=${goalSec}`);
  return t;
}

/**
 * Sweep a goal across the band edge in 1 s steps and return the worst
 * upward jump and the worst monotonicity inversion.
 */
function sweep(at: (goalSec: number) => number, boundSec: number) {
  const edge = boundSec * (1 - GOAL_OPTIMISM_TOLERANCE);
  const lo = Math.round(edge - 60);
  const hi = Math.round(edge + 60);
  let worstJump = 0;
  let worstJumpAt = 0;
  let worstInversion = 0;
  let worstInversionAt = 0;
  let prev = at(lo);
  for (let g = lo + 1; g <= hi; g++) {
    const cur = at(g);
    const jump = Math.abs(cur - prev);
    if (jump > worstJump) { worstJump = jump; worstJumpAt = g; }
    // goalSec RISES through the sweep (the goal gets softer). The prescribed
    // target must never FALL as the goal softens, i.e. must never have been
    // larger on the more-ambitious side.
    const inversion = prev - cur;
    if (inversion > worstInversion) { worstInversion = inversion; worstInversionAt = g; }
    prev = cur;
  }
  return { edge, worstJump, worstJumpAt, worstInversion, worstInversionAt };
}

describe('CONTINUOUS-TARGET-1 · the sweep reaches the boundary it is aimed at', () => {
  it('AUTHORING · the walk crosses the band edge', () => {
    const edge = CEILING_SEC * (1 - GOAL_OPTIMISM_TOLERANCE);
    // Liveness (Rule 18): a walk that never leaves one branch proves nothing,
    // so assert the sweep's endpoints land on DIFFERENT branches.
    expect(
      achievableRaceTarget({
        goalSec: Math.round(edge - 60), currentVdot: VDOT,
        raceDistanceMi: DIST_MI, totalWeeks: WEEKS,
      })!.source,
    ).toBe('projected_ceiling');
    expect(
      achievableRaceTarget({
        goalSec: Math.round(edge + 60), currentVdot: VDOT,
        raceDistanceMi: DIST_MI, totalWeeks: WEEKS,
      })!.source,
    ).toBe('goal');
  });
});

describe('CONTINUOUS-TARGET-1 · authoring · no step change at the band edge', () => {
  const r = sweep(authoredAt, CEILING_SEC);

  it('the prescribed target is CONTINUOUS across the edge', () => {
    expect(
      r.worstJump,
      `prescribed target jumped ${r.worstJump.toFixed(0)} s (${(r.worstJump / DIST_MI).toFixed(1)} s/mi) ` +
      `at goalSec=${r.worstJumpAt}, band edge ${r.edge.toFixed(0)} s`,
    ).toBeLessThanOrEqual(ROUNDING_STEP_S);
  });

  it('a MORE AMBITIOUS goal never buys a SLOWER prescribed target', () => {
    expect(
      r.worstInversion,
      `prescribed target was ${r.worstInversion.toFixed(0)} s SLOWER for the more ambitious goal ` +
      `at goalSec=${r.worstInversionAt}`,
    ).toBeLessThanOrEqual(0);
  });
});

describe('CONTINUOUS-TARGET-1 · execution · the same rule, the same shape', async () => {
  // One runner, one race: the watch may not bound the target by a different
  // formula than the block rehearsed. The race-pace brain clamps a stated goal
  // to the likely race-day range's FAST EDGE; this pins the spending of it.
  const base = await composeRaceOutlook(fixtureRace({ statedGoalSec: null }), '2026-09-01', EXEC_READS);
  const EDGE_SEC = base.expectedRaceDay.likelyRangeSec![0];
  const boundSec = EDGE_SEC / (1 - GOAL_OPTIMISM_TOLERANCE); // so sweep's edge == EDGE_SEC
  await primeExecution(Math.round(EDGE_SEC - 61), Math.round(EDGE_SEC + 61));
  const r = sweep(executedAt, boundSec);

  it('the walk crosses the edge (liveness)', async () => {
    const lo = await composeRaceOutlook(fixtureRace({ statedGoalSec: Math.round(EDGE_SEC - 60) }), '2026-09-01', EXEC_READS);
    const hi = await composeRaceOutlook(fixtureRace({ statedGoalSec: Math.round(EDGE_SEC + 60) }), '2026-09-01', EXEC_READS);
    expect(lo.execution.source).toBe('stated_goal_clamped_to_range_edge');
    expect(hi.execution.source).toBe('stated_goal_within_range');
  });

  it('the raced target is CONTINUOUS across the edge', () => {
    expect(
      r.worstJump,
      `raced target jumped ${r.worstJump.toFixed(0)} s at goalSec=${r.worstJumpAt}, edge ${EDGE_SEC.toFixed(0)} s`,
    ).toBeLessThanOrEqual(ROUNDING_STEP_S);
  });

  it('a MORE AMBITIOUS goal never buys a SLOWER raced target', () => {
    expect(
      r.worstInversion,
      `raced target was ${r.worstInversion.toFixed(0)} s SLOWER for the more ambitious goal at goalSec=${r.worstInversionAt}`,
    ).toBeLessThanOrEqual(0);
  });

  it('the bound still holds · a target is never faster than the fast edge', () => {
    for (const g of [Math.round(EDGE_SEC - 61), Math.round(EDGE_SEC - 30), Math.round(EDGE_SEC), Math.round(EDGE_SEC + 61)]) {
      expect(executedAt(g)).toBeGreaterThanOrEqual(Math.floor(EDGE_SEC / 10) * 10 - 10);
    }
  });
});

describe('CONTINUOUS-TARGET-1 · authoring · the bound still holds', () => {
  it('a target is never prescribed faster than the achievability band edge', () => {
    for (const g of [1, 3600, 9000, 10800, 11000, 12000, 20000]) {
      expect(authoredAt(g)).toBeGreaterThanOrEqual(CEILING_SEC * (1 - GOAL_OPTIMISM_TOLERANCE));
    }
  });

  it('a SOFT goal is still never clamped faster', () => {
    expect(authoredAt(4 * 3600)).toBe(4 * 3600);
  });
});
