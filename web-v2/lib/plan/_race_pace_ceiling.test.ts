/**
 * _race_pace_ceiling.test.ts · RACEPACE-1 + MPLABEL-1 (2026-08-25).
 *
 * THE DEFECT THESE PIN, in the owner's own numbers.
 *
 * Fifteen weeks out from CIM, goal 3:00, anchored on a 1:41:53 half (VDOT 44.1):
 *
 *   · every marathon-pace session in all fourteen weeks was built at 7:54/mi
 *   · `goalPaceSec` was 6:52/mi
 *   · both were called marathon pace
 *   · race day prescribed 6:52/mi off a block that never once rehearsed it
 *
 * The 7:54 was CORRECT. `marathonPaceSPerMi` refuses a goal marathon pace
 * faster than the runner's own threshold, because a session run there is not a
 * marathon session, and `Research/01` §"Marathon-specific correction" only ever
 * moves an MP prescription downward. Two things were wrong: the refusal was
 * silent, so every label and note asserted the goal over it; and nothing
 * applied the same realism to the race-day row, which threshold pace has had
 * since GOAL-2.
 *
 * These are behaviour tests, not doctrine claims — the citations live in
 * PACE.marathon-pace-is-not-ramped, PACE.marathon-pace-code-provenance and
 * GOAL.prescribed-race-pace-ceiling. No database.
 */
import { describe, it, expect } from 'vitest';
import {
  achievableRaceTarget,
  seasonalVdotCeiling,
  GOAL_OPTIMISM_TOLERANCE,
} from '@/lib/training/achievable-target';
import { resolveMarathonPace, marathonPaceSPerMi, buildWorkoutSpec } from './spec-builder';
import { tPaceFromVdot, predictRaceTime } from '@/lib/training/vdot';

/** The owner's live inputs on the day the CIM block is authored. */
const DAVID = {
  vdot: 44.1,          // AFC half, 1:41:53, 2026-08-17
  goalSec: 10800,      // 3:00:00
  distanceMi: 26.22,
  totalWeeks: 14,      // 11 build + 3 taper
};
const GOAL_PACE = Math.round(DAVID.goalSec / DAVID.distanceMi);  // 412 s/mi · 6:52

describe('the goal is not a pace prescription', () => {
  it('a goal marathon pace faster than current threshold is refused, and says so', () => {
    const currentT = tPaceFromVdot(DAVID.vdot)!;
    expect(GOAL_PACE).toBeLessThan(currentT);   // 6:52 is faster than his 7:42 T

    const read = resolveMarathonPace({ tPaceSec: currentT, goalPaceSPerMi: GOAL_PACE });
    expect(read.source).toBe('current_fitness');
    // The refusal is now legible. This field is the whole fix: it is what lets
    // a label downstream stop claiming the goal.
    expect(read.refusedGoalPaceSPerMi).toBe(GOAL_PACE);
    expect(read.paceSPerMi).toBe(currentT + 18);
  });

  it('a goal that genuinely sits in the marathon zone is prescribed exactly', () => {
    // Research/04 §4.4 · "MP exactly — not faster".
    const currentT = 420;
    const inZone = 445;                          // slower than T, faster than the long bulk
    const read = resolveMarathonPace({ tPaceSec: currentT, goalPaceSPerMi: inZone });
    expect(read.source).toBe('goal');
    expect(read.paceSPerMi).toBe(inZone);
    expect(read.refusedGoalPaceSPerMi).toBeNull();
  });

  it('a runner with no goal has refused nothing', () => {
    const read = resolveMarathonPace({ tPaceSec: 420 });
    expect(read.source).toBe('current_fitness');
    expect(read.refusedGoalPaceSPerMi).toBeNull();
  });

  it('the number is byte-identical to the pre-MPLABEL-1 helper', () => {
    for (const t of [380, 420, 456, 500, 620]) {
      for (const goal of [null, 300, 412, 445, 700]) {
        expect(marathonPaceSPerMi({ tPaceSec: t, goalPaceSPerMi: goal }))
          .toBe(resolveMarathonPace({ tPaceSec: t, goalPaceSPerMi: goal }).paceSPerMi);
      }
    }
  });
});

describe('the prescribed race target is bounded by the runway', () => {
  it("3:00 off VDOT 44.1 in 14 weeks is beyond what the block can build", () => {
    const t = achievableRaceTarget({
      goalSec: DAVID.goalSec,
      currentVdot: DAVID.vdot,
      raceDistanceMi: DAVID.distanceMi,
      totalWeeks: DAVID.totalWeeks,
    })!;
    expect(t.source).toBe('projected_ceiling');
    expect(t.basisModelled).toBe(true);
    // The stated goal is echoed, never overwritten.
    expect(t.goalSec).toBe(DAVID.goalSec);
    // The prescribed target is slower than the goal, and by a lot.
    expect(t.targetSec).toBeGreaterThan(DAVID.goalSec);
    expect(t.paceSPerMi).toBeGreaterThan(GOAL_PACE);
    // It is the runway's own ceiling, not an arbitrary haircut.
    expect(t.ceilingVdot).toBeCloseTo(seasonalVdotCeiling(DAVID.vdot, 14, DAVID.distanceMi).ceilingVdot, 6);
    expect(t.optimismFraction!).toBeGreaterThan(GOAL_OPTIMISM_TOLERANCE);
  });

  it('a goal inside the achievability band is prescribed as stated', () => {
    const ceiling = seasonalVdotCeiling(DAVID.vdot, 14, DAVID.distanceMi);
    const ceilingSec = predictRaceTime(ceiling.ceilingVdot, DAVID.distanceMi)!;
    // 2% faster than the ceiling · ambitious, inside the band, prescribed.
    const t = achievableRaceTarget({
      goalSec: Math.round(ceilingSec * 0.98),
      currentVdot: DAVID.vdot,
      raceDistanceMi: DAVID.distanceMi,
      totalWeeks: DAVID.totalWeeks,
    })!;
    expect(t.source).toBe('goal');
    expect(t.basisModelled).toBe(false);
    expect(t.targetSec).toBe(Math.round(ceilingSec * 0.98));
  });

  it('a SOFT goal is never clamped faster · the app does not overrule a conservative racer', () => {
    const t = achievableRaceTarget({
      goalSec: 4 * 3600,                        // a 4:00 marathon at VDOT 44.1
      currentVdot: DAVID.vdot,
      raceDistanceMi: DAVID.distanceMi,
      totalWeeks: DAVID.totalWeeks,
    })!;
    expect(t.source).toBe('goal');
    expect(t.targetSec).toBe(4 * 3600);
    expect(t.optimismFraction).toBe(0);
  });

  it('no fitness anchor means no clamp · a refusal needs something to refuse on', () => {
    const t = achievableRaceTarget({
      goalSec: DAVID.goalSec, currentVdot: null,
      raceDistanceMi: DAVID.distanceMi, totalWeeks: 14,
    })!;
    expect(t.source).toBe('unreadable');
    expect(t.targetSec).toBe(DAVID.goalSec);
    expect(t.basisModelled).toBe(false);
  });

  it('the target tightens when evidence moves the anchor, and only then', () => {
    const at = (v: number) => achievableRaceTarget({
      goalSec: DAVID.goalSec, currentVdot: v,
      raceDistanceMi: DAVID.distanceMi, totalWeeks: DAVID.totalWeeks,
    })!.targetSec;
    // Same calendar, same goal, more measured fitness → a faster prescribed
    // target. This is the trajectory: it is driven by the anchor, not the week.
    expect(at(46)).toBeLessThan(at(44.1));
    expect(at(48)).toBeLessThan(at(46));
    // And it stops at the goal rather than running past it.
    expect(at(60)).toBe(DAVID.goalSec);
  });
});

describe('the race row runs the prescribed target, not the ambition', () => {
  const currentT = tPaceFromVdot(DAVID.vdot)!;
  const prescribed = achievableRaceTarget({
    goalSec: DAVID.goalSec, currentVdot: DAVID.vdot,
    raceDistanceMi: DAVID.distanceMi, totalWeeks: DAVID.totalWeeks,
  })!.paceSPerMi;

  it('race day is built at the achievable target', () => {
    const built = buildWorkoutSpec(
      'race', DAVID.distanceMi, currentT, 162, null, 188,
      GOAL_PACE, null, currentT, false, prescribed,
    );
    expect(built.paceTargetSPerMi).toBe(prescribed);
    expect(built.paceTargetSPerMi).not.toBe(GOAL_PACE);
    const spec = built.spec as Record<string, number>;
    expect(spec.pace_target_s_per_mi_lo).toBe(prescribed - 5);
    expect(spec.pace_target_s_per_mi_hi).toBe(prescribed + 5);
  });

  it('the mid-race abort is measured against what the runner was told to run', () => {
    const built = buildWorkoutSpec(
      'race', DAVID.distanceMi, currentT, 162, null, 188,
      GOAL_PACE, null, currentT, false, prescribed,
    );
    const rules = (built.spec as { rules?: Array<Record<string, unknown>> }).rules ?? [];
    const paceAbort = rules.find((r) => r.metric === 'pace' && r.kind === 'abort');
    expect(paceAbort).toBeDefined();
    // Off the ambition this threshold sat faster than the pace the plan itself
    // prescribed, so a correctly-executed race was already past it at the gun.
    expect(Number(paceAbort!.value)).toBeGreaterThan(prescribed);
  });

  it('omitting the argument is byte-identical to before the change', () => {
    const withArg = buildWorkoutSpec(
      'race', DAVID.distanceMi, currentT, 162, null, 188,
      GOAL_PACE, null, currentT, false, null,
    );
    const legacy = buildWorkoutSpec(
      'race', DAVID.distanceMi, currentT, 162, null, 188,
      GOAL_PACE, null, currentT,
    );
    expect(withArg).toEqual(legacy);
    expect(legacy.paceTargetSPerMi).toBe(GOAL_PACE);
  });

  it('marathon-pace work is NOT moved onto the prescribed target · the refusal still governs', () => {
    // The clamped target (7:41) is still faster than his threshold (7:42), so
    // an MP session paced there would be a threshold session wearing an MP
    // label. `resolveMarathonPace` must keep refusing it. This is why the race
    // target and the goal are two separate arguments.
    const read = resolveMarathonPace({ tPaceSec: currentT, goalPaceSPerMi: prescribed });
    expect(read.source).toBe('current_fitness');
    expect(read.paceSPerMi).toBe(currentT + 18);
  });
});
