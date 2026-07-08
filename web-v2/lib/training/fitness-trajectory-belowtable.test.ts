/**
 * lib/training/fitness-trajectory-belowtable.test.ts · AUDIT P1-56 / P1-13
 * (2026-07-07) — below-table GOAL support in the goal-seeking trajectory.
 *
 * Distinct from vdot-slow-runner-floor.test.ts (which covers a below-table
 * CURRENT fitness / anchor pace): this file covers a below-table GOAL for a
 * runner whose CURRENT fitness IS real/in-table (e.g. a fit VDOT-45 runner
 * setting a deliberately easy 6:30 marathon goal — a recovery race, a
 * "just finish" goal, running with a slower friend/family member). Before
 * this fix, projectFitnessTrajectory returned null outright for ANY goal
 * implying VDOT < 30, discarding the whole projection instead of correctly
 * reading "already ahead of this easy goal."
 */
import { describe, it, expect } from 'vitest';
import { projectFitnessTrajectory } from './fitness-trajectory';
import { predictRaceTime } from './vdot';

const MARATHON_MI = 26.2188;
const SLOW_GOAL_SEC = 6 * 3600 + 30 * 60; // 6:30 marathon — raw VDOT ~20.4, off-table

describe('P1-56 · projectFitnessTrajectory — below-table (honest slow) goal', () => {
  it('no longer returns null for a fit runner with a slow/easy goal', () => {
    const traj = projectFitnessTrajectory({
      currentVdot: 45, goalSec: SLOW_GOAL_SEC, raceDistanceMi: MARATHON_MI, weeksToRace: 12,
    });
    expect(traj).not.toBeNull();
  });

  it('goalBelowTable is true, and goalVdot/gapVdot are honestly null (never a fabricated VDOT)', () => {
    const traj = projectFitnessTrajectory({
      currentVdot: 45, goalSec: SLOW_GOAL_SEC, raceDistanceMi: MARATHON_MI, weeksToRace: 12,
    })!;
    expect(traj.goalBelowTable).toBe(true);
    expect(traj.goalVdot).toBeNull();
    expect(traj.gapVdot).toBeNull();
  });

  it('reads as reachable + aheadOfGoal (the runner has already exceeded this easy goal)', () => {
    const traj = projectFitnessTrajectory({
      currentVdot: 45, goalSec: SLOW_GOAL_SEC, raceDistanceMi: MARATHON_MI, weeksToRace: 12,
    })!;
    expect(traj.reachable).toBe(true);
    expect(traj.aheadOfGoal).toBe(true);
  });

  it('gapSec is honest (direct seconds comparison, negative = ahead of goal) — not a synthesized VDOT round-trip', () => {
    const traj = projectFitnessTrajectory({
      currentVdot: 45, goalSec: SLOW_GOAL_SEC, raceDistanceMi: MARATHON_MI, weeksToRace: 12,
    })!;
    expect(traj.gapSec).not.toBeNull();
    expect(traj.gapSec!).toBeLessThan(0); // projected time is faster than the slow goal
    // Sanity: gapSec should be close to (predictRaceTime(45, marathon) - SLOW_GOAL_SEC).
    const expectedGap = (predictRaceTime(45, MARATHON_MI) ?? 0) - SLOW_GOAL_SEC;
    expect(Math.abs(traj.gapSec! - expectedGap)).toBeLessThan(120); // within 2 min (execution/overperf noise)
  });

  it('projectedGainVdot is ~0 (no gain needed to hit an already-exceeded goal)', () => {
    const traj = projectFitnessTrajectory({
      currentVdot: 45, goalSec: SLOW_GOAL_SEC, raceDistanceMi: MARATHON_MI, weeksToRace: 12,
    })!;
    expect(traj.projectedGainVdot).toBeCloseTo(0, 1);
  });

  it('an off-the-top goal (impossibly fast, VDOT>85) still returns null — GOAL-4 in generate.ts is the doctrine-designated gate for that, this function trusts its caller', () => {
    const impossibleGoalSec = 60; // 1:00 marathon — absurdly fast, VDOT >> 85
    const traj = projectFitnessTrajectory({
      currentVdot: 45, goalSec: impossibleGoalSec, raceDistanceMi: MARATHON_MI, weeksToRace: 12,
    });
    expect(traj).toBeNull();
  });

  it('BYTE-SAFETY: an ordinary in-table goal is completely unaffected', () => {
    const realGoalSec = 3 * 3600 + 30 * 60; // 3:30 marathon — real, in-table goal for a VDOT-45 runner
    const traj = projectFitnessTrajectory({
      currentVdot: 45, goalSec: realGoalSec, raceDistanceMi: MARATHON_MI, weeksToRace: 12,
    })!;
    expect(traj.goalBelowTable).toBe(false);
    expect(traj.goalVdot).not.toBeNull();
    expect(traj.gapVdot).not.toBeNull();
    expect(typeof traj.goalVdot).toBe('number');
  });
});
