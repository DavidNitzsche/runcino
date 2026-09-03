/**
 * lib/adaptation/canonical/plan-load.ts · THE COMMON PROJECTED PLAN-LOAD
 * REPRESENTATION.
 *
 * `docs/ADAPTATION_ENGINE_CONTRACT.md` "Arbitration when levers disagree":
 *
 *     "Convert proposed changes into a common projected plan-load
 *      representation. Evaluate their combined effect on the future plan."
 *
 * Three levers propose in three different units. Seconds per mile, weekly
 * miles and long-run miles cannot be added together, so the contract's
 * requirement to evaluate their COMBINED effect needs one scale they can all
 * be expressed on. This file is that scale and nothing more.
 *
 * ── WHAT THIS IS NOT, STATED FIRST BECAUSE IT MATTERS MOST ─────────────────
 *
 * This is NOT a training-load model. It is not TSS, it is not TRIMP, it is not
 * ACWR, and it must never be used to decide whether a runner is fatigued,
 * ready, or overreaching. `docs/PLAN_SIMPLIFICATION_DOCTRINE.md` removed daily
 * training form from plan decisions entirely, and a load number invented here
 * would be exactly the "hidden rule that silently makes the plan easier or
 * reorganizes it" that ruling names.
 *
 * Its only job is COMPARING TWO PROJECTIONS OF THE SAME PLAN, one with a
 * proposal applied and one without, to answer "does the combination make the
 * week incoherent". A shared arbitrary unit is sufficient for that because only
 * the DIFFERENCE is ever read, never the absolute value. `demandIndex` is
 * therefore deliberately unitless and deliberately not exported to anything
 * outside arbitration.
 *
 * ── THE COEFFICIENTS, AND WHY THEY ARE DELIBERATELY CRUDE ──────────────────
 *
 * Every coefficient below is a stated modelling choice, not a physiological
 * claim, and each is written so a reader can disagree with it in one line. A
 * more sophisticated model would be a second opinion about training load, which
 * `docs/BRAIN_CONSTITUTION.md` assigns to the Training Load owner, not here.
 *
 * ── RULE 22 · WHAT A GATE OVER THIS FILE CANNOT FAIL ON ────────────────────
 *
 * It cannot fail on the coefficients being wrong. Any monotonic set produces
 * the same ORDERING of proposals, which is all arbitration reads, so a test can
 * prove the comparison is consistent but never that the weights are right. If
 * this file is ever used for anything that reads the absolute number, that
 * argument stops holding and the file needs a different justification.
 */

/** A projection of one week of plan. Unitless by design. */
export interface ProjectedPlanLoad {
  readonly weeklyMi: number;
  readonly longRunMi: number;
  readonly qualityMinutes: number;
  /** The single comparable scalar. Only differences are ever read. */
  readonly demandIndex: number;
}

/**
 * Quality minutes cost more than easy minutes. Expressed as equivalent easy
 * miles per quality minute.
 *
 * One quality minute is treated as costing what roughly a third of an easy mile
 * costs. Crude and admitted: the point is that quality is not free, so a pace
 * change is not load-neutral. The contract says so directly: "Do not pretend
 * pace changes are load-neutral."
 */
export const QUALITY_MINUTE_TO_EASY_MILE = 0.33;

/**
 * The long run costs more than the same miles spread across the week.
 *
 * Applied to the long run's miles ON TOP of their inclusion in weekly volume,
 * so a mile moved onto the long run raises demand while total mileage is
 * unchanged. That is the property arbitration needs, and it is why the long run
 * is a lever of its own rather than a slice of weekly volume.
 */
export const LONG_RUN_SURCHARGE_PER_MI = 0.25;

/**
 * How much a faster threshold anchor raises the cost of the same quality
 * minutes, per second per mile of anchor change.
 *
 * Deliberately small. A 3 s/mi anchor move makes existing threshold work about
 * 1.5% harder at 0.005 per s/mi, which keeps an ordinary pace correction below
 * the materiality bar while a large one clears it. This is the coefficient that
 * decides whether a pace change is "a small correction that may proceed" or a
 * material lever, so it is the one most worth arguing with.
 */
export const PACE_SEC_PER_MI_TO_QUALITY_COST = 0.005;

export interface PlanLoadInputs {
  readonly weeklyMi: number;
  readonly longRunMi: number;
  readonly qualityMinutes: number;
  /**
   * Signed anchor change relative to the plan as authored. Negative is faster,
   * which is MORE demanding, so the sign is inverted when costed.
   */
  readonly thresholdAnchorDeltaSecPerMi: number;
}

export function projectPlanLoad(input: PlanLoadInputs): ProjectedPlanLoad {
  const qualityCostMultiplier =
    1 + -input.thresholdAnchorDeltaSecPerMi * PACE_SEC_PER_MI_TO_QUALITY_COST;

  const demandIndex =
    input.weeklyMi
    + input.longRunMi * LONG_RUN_SURCHARGE_PER_MI
    + input.qualityMinutes * QUALITY_MINUTE_TO_EASY_MILE * qualityCostMultiplier;

  return {
    weeklyMi: input.weeklyMi,
    longRunMi: input.longRunMi,
    qualityMinutes: input.qualityMinutes,
    demandIndex: Math.round(demandIndex * 1000) / 1000,
  };
}

/** The change one projection represents against another. */
export function demandDelta(base: ProjectedPlanLoad, next: ProjectedPlanLoad): number {
  return Math.round((next.demandIndex - base.demandIndex) * 1000) / 1000;
}

/** The change as a share of the baseline, which is what materiality reads. */
export function demandDeltaShare(base: ProjectedPlanLoad, next: ProjectedPlanLoad): number {
  if (base.demandIndex === 0) return 0;
  return demandDelta(base, next) / base.demandIndex;
}
