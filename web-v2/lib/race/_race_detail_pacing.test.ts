/**
 * RACE-DETAIL PACING TRUTH-SOURCE INVARIANTS (2026-08-17).
 *
 * The web race-detail page derived its goal-pace strip stat, PACING PLAN
 * blocks, splits, and gels from the RAW stated goal while the watch and
 * execution plan already paced off the effective target. These tests lock
 * the adoption:
 *   1. goal fantasy (>5% past projection) → projection paces + stretch line
 *   2. goal sane → goal paces, no stretch line
 *   3. B · SAFE reads back the stored meta.goalSafeDisplay; the fallback is
 *      effective + 3.3%, never goal + 7:00
 *   4. certification / registered render nothing when unknown
 */
import { describe, it, expect } from 'vitest';
import { resolveEffectiveRaceTarget, roundTargetSec } from './effective-race-target';
import {
  composeRaceDetailPacing,
  certificationFromMeta,
  registeredFromMeta,
  B_SAFE_FRACTION,
} from './race-detail-pacing';
import { raceCarbsPerHourTarget } from './distance-doctrine';
import { parseRaceTime } from '@/lib/training/vdot';

const MARATHON = 26.2;

describe('composeRaceDetailPacing · effective-target adoption', () => {
  it('goal fantasy → projection writes the paces, goal demoted to stretch', () => {
    // 3:00 goal (10800) at 3:22 fitness (12120): >5% adrift.
    const effective = resolveEffectiveRaceTarget(10800, 12120);
    const pf = composeRaceDetailPacing({
      goalDisplay: '3:00:00',
      effective,
      goalSafeDisplay: null,
      distanceMi: MARATHON,
      netElevFt: 0,
    });
    expect(pf.effectiveSource).toBe('projection');
    // 2026-08-30 · Rule 9. Was '3:22:00' — the UNREDUCED projection, which is
    // the cliff: a goal one second inside doctrine's 5% band was raced at the
    // goal, a goal one second outside it was thrown back to the projection
    // 606 s slower. 3:12:00 is the band EDGE, the bound doctrine states.
    expect(pf.effectiveGoal).toBe('3:12:00');           // the 5% band edge
    expect(pf.stretchGoal).toBe('3:00:00');             // the stretch line
    expect(pf.aGoal).toBe('3:00:00');                   // hero still shows the stated goal
    // Pace off the bound, not the goal: 11520/26.2 ≈ 439.7 s/mi.
    expect(pf.goalPace).toBe('7:20');
    // Splits/pacing recompute off the effective target — cumulative of the
    // final pacing block lands at the effective time, not the goal.
    expect(pf.pacing.length).toBe(4);
    expect(parseRaceTime(pf.pacing[3].cum)).toBeGreaterThan(11514); // > 95% of projection
    expect(parseRaceTime(pf.pacing[3].cum)).toBeLessThan(12300);
    // Gels sized off the longer honest duration AND the marathon's own
    // Research/18 §11 (:372) rate of 60-90 g/hr — not the old `hours × 1.7`
    // house formula (2026-08-17 doctrine audit). Default serving is 22 g.
    // Sized off the EFFECTIVE target the component actually paced from, read
    // back out of it rather than hand-copied — a duplicated constant here only
    // proves the test agrees with itself (Rule 18).
    const hours = effective.targetSec / 3600;
    const rate = raceCarbsPerHourTarget(MARATHON, effective.targetSec)!.targetGPerHr;
    expect(rate).toBeGreaterThanOrEqual(60);
    expect(pf.gels.length).toBe(Math.ceil((hours * rate) / 22));
    // Two caffeinated stops, at ~mi 13 and ~mi 20 (:372).
    expect(pf.gels.filter((g) => g.caf)).toHaveLength(2);
  });

  it('goal sane (within 5% of projection) → goal writes the paces, no stretch', () => {
    const effective = resolveEffectiveRaceTarget(10800, 11000);
    const pf = composeRaceDetailPacing({
      goalDisplay: '3:00:00',
      effective,
      goalSafeDisplay: null,
      distanceMi: MARATHON,
      netElevFt: 0,
    });
    expect(pf.effectiveSource).toBe('goal');
    expect(pf.effectiveGoal).toBe('3:00:00');
    expect(pf.stretchGoal).toBeNull();
    expect(pf.goalPace).toBe('6:52');                   // 10800/26.2 ≈ 412.2 s/mi
  });

  it('no projection snapshot → goal fallback (cold start)', () => {
    const effective = resolveEffectiveRaceTarget(10800, null);
    const pf = composeRaceDetailPacing({
      goalDisplay: '3:00:00',
      effective,
      goalSafeDisplay: null,
      distanceMi: MARATHON,
      netElevFt: 0,
    });
    expect(pf.effectiveSource).toBe('goal');
    expect(pf.effectiveGoal).toBe('3:00:00');
    expect(pf.stretchGoal).toBeNull();
  });

  it('no goal at all → everything degrades to placeholders', () => {
    const pf = composeRaceDetailPacing({
      goalDisplay: null,
      effective: null,
      goalSafeDisplay: null,
      distanceMi: MARATHON,
      netElevFt: 0,
    });
    expect(pf.aGoal).toBe('·');
    expect(pf.effectiveGoal).toBe('·');
    expect(pf.bGoal).toBe('·');
    expect(pf.pacing).toEqual([]);
    expect(pf.splits).toEqual([]);
    expect(pf.gels).toEqual([]);
  });
});

describe('B · SAFE readback', () => {
  it('stored meta.goalSafeDisplay wins over any derivation', () => {
    const effective = resolveEffectiveRaceTarget(10800, 11000);
    const pf = composeRaceDetailPacing({
      goalDisplay: '3:00:00',
      effective,
      goalSafeDisplay: '3:12:00',                        // runner-edited B
      distanceMi: MARATHON,
      netElevFt: 0,
    });
    expect(pf.bGoal).toBe('3:12:00');
    expect(pf.bGoalSource).toBe('stored');
  });

  it('fallback is effective + 3.3%, not goal + 7:00', () => {
    // Fantasy goal: effective = projection 12120. Old bug: B = 10800 + 420
    // = 3:07:00 — FASTER than the honest projection.
    const effective = resolveEffectiveRaceTarget(10800, 12120);
    const pf = composeRaceDetailPacing({
      goalDisplay: '3:00:00',
      effective,
      goalSafeDisplay: null,
      distanceMi: MARATHON,
      netElevFt: 0,
    });
    const effSec = effective.targetSec;
    const expected = effSec + Math.round(effSec * B_SAFE_FRACTION);
    expect(parseRaceTime(pf.bGoal)).toBe(expected);
    expect(parseRaceTime(pf.bGoal)).not.toBe(10800 + 420);
    expect(pf.bGoalSource).toBe('derived');
  });
});

describe('unknown race facts render nothing', () => {
  it('certification: only a real stored value survives', () => {
    expect(certificationFromMeta({})).toBe('·');
    expect(certificationFromMeta(null)).toBe('·');
    expect(certificationFromMeta({ certification: '' })).toBe('·');
    expect(certificationFromMeta({ certification: 42 })).toBe('·');
    expect(certificationFromMeta({ certification: 'USATF certified' })).toBe('USATF certified');
  });

  it('registered: null (unknown) unless the runner recorded it — no default-true', () => {
    expect(registeredFromMeta({})).toBeNull();
    expect(registeredFromMeta(null)).toBeNull();
    expect(registeredFromMeta({ registered: 'yes' })).toBeNull();
    expect(registeredFromMeta({ registered: true })).toBe(true);
    expect(registeredFromMeta({ registered: false })).toBe(false);
  });
});
