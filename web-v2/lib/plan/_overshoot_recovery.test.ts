/**
 * Regression · a deliberately-reduced prescription is not a load ceiling.
 *
 * THE INCIDENT (2026-08-24). David finished a half on 2026-08-16 and sat in a
 * doctrine-prescribed 2-week recovery block (Research/00b §"Half Marathon
 * Recovery (14-day)") whose whole point is to prescribe far less than he
 * habitually runs. `detectVolumeOvershoot` baselined on that prescription, so
 * a 32mi week against 17mi scheduled read as an 88% overshoot and produced an
 * apply-now 17% shave of his next seven days — including the day-14 long run
 * that hands off to the CIM block. His own chronic load over the preceding
 * four weeks was ~29mi/wk, so he had in fact run a NORMAL week, slightly
 * under, while recovering.
 *
 * THE OWNER'S RULING. "Keep auto-apply, but it must not fire on a positive
 * deviation. Running more than prescribed stops triggering a cut."
 *
 * Read literally that deletes the detector — a positive deviation against the
 * baseline is the only thing it has ever fired on, and there is no shortfall
 * limb here at all (shortfalls belong to detectTrainingGap and
 * detectMissedKeyWorkout, untouched). The implemented reading is the general
 * form: running more than PRESCRIBED warrants a cut only when it is also more
 * than the runner is USED TO. Two guards, both proved below.
 */
import { describe, it, expect } from 'vitest';
import { overshootFires } from './adapt';

// The incident's real numbers, read out of production on 2026-08-24.
const COMPLETED_MI = 32;      // 08-17 .. 08-24, deduped
const SCHEDULED_MI = 17;      // recovery block, 08-17 .. 08-23
const CHRONIC_MI = 28.7;      // 28d ending 08-16 · his own weekly load
/*
 * DECLAREDLEVEL-0 (2026-09-02) · the fallback baseline used to be
 * `EXPERIENCE_CAPS_MI[level]`, a weekly-volume ceiling keyed to the word the
 * runner typed at onboarding. The table is deleted and `detectVolumeOvershoot`
 * now passes its own chronic weekly load in that argument slot, refusing when
 * it has neither a schedule nor a chronic read. The ARITHMETIC these cases lock
 * is untouched, so they keep their numbers — as a plain constant that claims
 * nothing about who is allowed to run what.
 */
const CAP = 80;
/** The other magnitude these cases exercise. Also just a number now. */
const FALLBACK_45 = 45;

describe('volume overshoot · a reduced prescription is not a load ceiling', () => {
  it('THE DEFECT · the old three-argument call still fires on the incident', () => {
    // This is the behaviour that shipped, kept as the control. If this ever
    // goes false the guards below have stopped proving anything.
    expect(overshootFires(COMPLETED_MI, SCHEDULED_MI, CAP)).toBe(true);
  });

  it('GUARD B · the chronic floor stops the shave on the incident numbers', () => {
    // max(17, 28.7) × 1.25 = 35.9 · 32 is under it.
    expect(
      overshootFires(COMPLETED_MI, SCHEDULED_MI, CAP, { chronicWeeklyMi: CHRONIC_MI }),
    ).toBe(false);
  });

  it('GUARD A · a recovery block never fires, whatever the arithmetic says', () => {
    // Independent of the floor: cutting distance is the wrong instrument for
    // a block whose constraint is on quality (Research/00b §Week-by-Week).
    // Deliberately paired with NO chronic figure so it is Guard A that holds.
    expect(
      overshootFires(COMPLETED_MI, SCHEDULED_MI, CAP, { recoveryBlock: true }),
    ).toBe(false);
    // ...and it holds even for a genuinely enormous week, because the
    // response is wrong rather than the threshold.
    expect(
      overshootFires(90, SCHEDULED_MI, CAP, { recoveryBlock: true, chronicWeeklyMi: 20 }),
    ).toBe(false);
  });

  it('THE SAFETY NET SURVIVES · genuine overreach against a real base still fires', () => {
    // Chronic 45, plan 50, ran 70 → 70 > max(50,45) × 1.25 = 62.5.
    expect(overshootFires(70, 50, CAP, { chronicWeeklyMi: 45 })).toBe(true);
    // A comeback runner whose chronic load has genuinely fallen is NOT
    // protected by their own history — the floor can only raise the bar.
    expect(overshootFires(40, 15, CAP, { chronicWeeklyMi: 10 })).toBe(true);
  });

  it('the floor only ever RAISES the bar · it can never make the detector keener', () => {
    // Every chronic value at or under the prescription leaves the verdict
    // byte-identical to the old two-baseline rule.
    for (const chronic of [0, 5, 10, 20, 30, 42]) {
      expect(overshootFires(55, 42, CAP, { chronicWeeklyMi: chronic }))
        .toBe(overshootFires(55, 42, CAP));
    }
  });

  it('a null or zero chronic load is "no floor", not "a floor of zero"', () => {
    // Cold start · weeklyAvgFromWindow refuses to state an average off under a
    // week of observable history, and that must not silence the detector.
    expect(overshootFires(60, 0, FALLBACK_45, { chronicWeeklyMi: null })).toBe(true);
    expect(overshootFires(60, 0, FALLBACK_45, { chronicWeeklyMi: 0 })).toBe(true);
    expect(overshootFires(60, 0, FALLBACK_45, {})).toBe(true);
  });

  it('an omitted context is byte-identical to the pre-fix predicate', () => {
    // The existing P1-55 invariants call the three-argument form; they must
    // keep meaning exactly what they meant.
    for (const [done, sched] of [[42, 42], [55, 42], [52.5, 42], [50, 0], [60, 0]] as const) {
      expect(overshootFires(done, sched, FALLBACK_45, {}))
        .toBe(overshootFires(done, sched, FALLBACK_45));
    }
  });

  it('a taper week is covered by the same arithmetic · no plan-shape flag needed', () => {
    // Race week schedules 20 against a 60mi base; the runner runs 58, which is
    // simply their ordinary week. Old rule: 58 > 25 → shave. New: 58 ≤ 75.
    expect(overshootFires(58, 20, CAP)).toBe(true);
    expect(overshootFires(58, 20, CAP, { chronicWeeklyMi: 60 })).toBe(false);
  });

  it('a cutback week is covered too', () => {
    // Down week at 33 against a 45mi base; ran 44.
    expect(overshootFires(44, 33, CAP)).toBe(true);
    expect(overshootFires(44, 33, CAP, { chronicWeeklyMi: 45 })).toBe(false);
  });
});
