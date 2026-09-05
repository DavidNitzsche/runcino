/**
 * lib/adaptation/canonical/demand-ceiling.ts · THE SEAM BETWEEN THE DEMAND
 * MODEL AND PLAN-LEVEL ARBITRATION.
 *
 * `arbitration.ts` rule 1 asks one question — "is the COMPLETE PROJECTED WEEK
 * at this athlete's own demand ceiling" — and until this file existed it could
 * not be asked at all on a live evaluation. `canonical-shadow/live-input.ts`
 * supplied the ceiling as `absent(...)` with the honest note that "no weekly
 * demand model is wired into this app yet", so rule 1 was structurally dark:
 * CLAUDE.md Rule 15's failure exactly, a mechanism no case could reach.
 *
 * `lib/plan/adjudication/weekly-demand.ts` is that model, and it is the one
 * owner of the question (`docs/BRAIN_CONSTITUTION.md`: one question, one
 * canonical owner). This file does not answer it a second time. It:
 *
 *   1 · asks the model for the like-for-like ceiling comparison
 *       (`compareToAthleteCeiling`), which picks the BASIS both sides are
 *       priced on and prices them through `ceilingCostOf`;
 *   2 · proves the PROPOSED week can be priced on that same basis before
 *       handing anything back, so arbitration never receives a ceiling it
 *       cannot compare against;
 *   3 · carries the model's own `unknownComponents` and its `explain` out with
 *       the ceiling, so an unknown stays visible downstream (Rule 11).
 *
 * ── RULE 16 · ONE SCALE, NOT TWO ───────────────────────────────────────────
 *
 * Arbitration used to project weeks through `plan-load.ts`'s three-term
 * `projectPlanLoad` and compare the result against a ceiling supplied from
 * somewhere else entirely. Two definitions of "what a week costs", one
 * comparison. `priceWeekOnBasis` below is now the ONLY way arbitration prices
 * a week, and it goes straight through `priceProjectedWeek`, which goes
 * straight through `ceilingCostOf` — the model's own single pricing door.
 *
 * The old scale is not deleted, because it is not a rival: `weekly-demand.ts`
 * IMPORTS its three coefficients, and on BASE_ONLY with an unknown context the
 * two are byte-for-byte the same number. `_demand_ceiling.test.ts` asserts that
 * identity rather than trusting this paragraph (Rule 20).
 *
 * ── RULE 11 · THE THREE FACTS THIS FILE KEEPS APART ────────────────────────
 *
 *   READ    · a ceiling exists, on a stated basis, and the proposed week
 *             prices on the same basis. Rule 1 can fire.
 *   ABSENT  · nobody has demonstrated an absorbed week to price a ceiling
 *             from, or the caller did not look. Rule 1 cannot fire, and that
 *             is not "no ceiling" and not "at the ceiling".
 *   FAILED  · a ceiling exists but the PROPOSED week cannot be priced on its
 *             basis. Rule 1 cannot fire, and the reason is different from
 *             ABSENT: something that should have been readable was not.
 *
 * The refusal branches carry no `value`, because `Measured<T>` is a
 * discriminated union — a caller cannot read a ceiling that is not there
 * without the compiler stopping it.
 *
 * ── WHY NOTHING HERE NAMES A CONTEXT COMPONENT ─────────────────────────────
 *
 * `_forbidden_inputs.test.ts` forbids the token `acwr` (among others) in every
 * engine source file under this directory, because
 * `docs/PLAN_SIMPLIFICATION_DOCTRINE.md` removed those inputs' DECISION
 * AUTHORITY. The demand model reads acute load as one of seven terms in a
 * COST, never as a verdict, and it lives in `lib/plan` where that vocabulary
 * is legitimate. So the context travels through this file as one opaque
 * `WeekDemandContext` value that this engine never opens. That is not a
 * loophole around the gate — it is the gate's own shape: the engine has
 * nowhere to put a readiness score and no name for one.
 *
 * ── RULE 22 · WHAT A GATE OVER THIS FILE CANNOT FAIL ON ────────────────────
 *
 * · THE CEILING BEING THE RIGHT NUMBER. It is his biggest absorbed week,
 *   priced by a model whose five POLICY_ASSUMPTION coefficients nobody has
 *   calibrated. Every test here proves the two sides are commensurable and
 *   that refusals stay refusals. None can prove the ceiling is true.
 * · WHETHER `absorbed` WAS JUDGED CORRECTLY. This file takes the demonstrated
 *   weeks as given. A loader that marks a week he was hurt by as absorbed
 *   raises the ceiling and nothing here can tell.
 * · WHETHER THE CALLER APPLIED RULE 8's HABIT FILTER to `demonstratedWeeks`.
 *   The model states that contract on the field; enforcing it is the loader's
 *   own gate, not this one's.
 */
import {
  compareToAthleteCeiling,
  priceProjectedWeek,
  priceWeek,
  unknownWeekDemandContext,
  type CeilingBasis,
  type DemonstratedWeek,
  type ProjectedWeekQuantities,
  type WeekDemandContext,
} from '@/lib/plan/adjudication/weekly-demand';
import { absent, failed, measured, type Measured } from './input';

export type {
  CeilingBasis,
  DemonstratedWeek,
  ProjectedWeekQuantities,
  WeekDemandContext,
};

/**
 * The ceiling arbitration compares against, and everything a reader needs to
 * judge it without re-running the model.
 *
 * `value` and every projected week arbitration prices are on `basis`, in
 * equivalent easy miles. Reading `value` against a week priced any other way
 * is the mixed-basis defect `weekly-demand.ts` was rewritten to remove.
 */
export interface AthleteWeeklyDemandCeiling {
  /** Equivalent easy miles, on `basis`. */
  readonly value: number;
  readonly basis: CeilingBasis;
  /**
   * The proposed week's own context, opaque to this engine. Held so every
   * projection arbitration makes is priced on the same terms as the ceiling.
   */
  readonly context: WeekDemandContext;
  /** The absorbed week the ceiling came from. */
  readonly fromWeekStartISO: string | null;
  readonly consideredWeeks: number;
  /** Absorbed weeks whose context could not be reconstructed (Rule 11). */
  readonly weeksWithoutContext: readonly string[];
  /**
   * Components of the PROPOSED week the model could not compute. Carried out
   * rather than swallowed: an unknown that never surfaces is the shape Rule 11
   * exists to stop, and a ceiling test running over a week with three unknown
   * terms is a different fact from one running over a fully-priced week.
   */
  readonly unknownComponents: readonly string[];
  /** The model's own sentence about this comparison. */
  readonly detail: string;
}

export interface DemandCeilingRequest {
  /** The proposed week's context. Opaque here; built by the loader. */
  readonly context: WeekDemandContext;
  /** The week as authored, before any proposal. */
  readonly week: ProjectedWeekQuantities;
  /**
   * Weeks he has already run, for the ceiling. `null` is "the caller did not
   * look"; an EMPTY array is "the caller looked and found none". Both give an
   * absent ceiling and a DIFFERENT sentence, because they are different facts.
   *
   * RULE 8 · this is a HABIT reader and the caller must have filtered it
   * through `lib/training/normal-window.ts`. The model states the same
   * contract on its own field; this one repeats it because this is the door
   * the canonical engine actually comes through.
   */
  readonly demonstratedWeeks: readonly DemonstratedWeek[] | null;
}

/**
 * Price one projection of the week on the ceiling's own basis.
 *
 * THE ONLY WAY ARBITRATION MAY PRICE A WEEK. Returns `null` when the week
 * cannot be priced, which is a refusal and never a zero.
 */
export function priceWeekOnBasis(
  ceiling: AthleteWeeklyDemandCeiling,
  week: ProjectedWeekQuantities,
): number | null {
  return priceProjectedWeek(ceiling.context, week, ceiling.basis);
}

/**
 * Price a week when NO ceiling is known.
 *
 * Rule 1 cannot fire without a ceiling, but arbitration still reports how much
 * demand each proposal moves, and that number has to come from somewhere. It
 * comes from here: the same `priceProjectedWeek` door, on BASE_ONLY, against a
 * context that knows nothing. So there is still exactly one pricing function
 * in the engine, and the no-ceiling case is a narrower READING of it rather
 * than a second scale.
 *
 * On BASE_ONLY with an unknown context this is identically
 * `plan-load.ts`'s `projectPlanLoad(...).demandIndex`, which is what makes the
 * change to arbitration a strict generalisation rather than a rescale.
 */
export function priceWeekWithoutCeiling(
  weekStartISO: string,
  week: ProjectedWeekQuantities,
): number {
  const priced = priceProjectedWeek(
    unknownWeekDemandContext(weekStartISO), week, 'BASE_ONLY',
  );
  // BASE_ONLY reads only the four quantities above, all of them `number`, so
  // this cannot refuse. Written as a real branch rather than a `!` so a future
  // change to `ceilingCostOf` produces an honest failure instead of a NaN
  // travelling into a decision record.
  if (priced === null) {
    throw new Error(
      'priceWeekWithoutCeiling: BASE_ONLY refused a week whose four quantities are all '
      + 'numbers. ceilingCostOf has changed shape and arbitration cannot price a week.',
    );
  }
  return priced;
}

/**
 * Resolve this athlete's weekly demand ceiling, or refuse and say why.
 *
 * The model picks the basis; this function's whole job is to make sure the
 * PROPOSED week can be priced on it before handing the ceiling over, so that
 * arbitration never has to defend against half a comparison.
 */
export function resolveAthleteWeeklyDemandCeiling(
  req: DemandCeilingRequest,
): Measured<AthleteWeeklyDemandCeiling> {
  const proposedInput = { ...req.context, ...req.week };
  const pricing = priceWeek(proposedInput);
  const unknownComponents = pricing.unknownComponents.map(String);

  const comparison = compareToAthleteCeiling(proposedInput, req.demonstratedWeeks);

  if (comparison === null) {
    if (req.demonstratedWeeks === null) {
      return absent(
        'no demonstrated weeks were supplied for this athlete, so nothing has been '
        + 'measured that a ceiling could be priced from. That is "nobody looked", which '
        + 'is not the same as this athlete having no ceiling.',
      );
    }
    return absent(
      `${req.demonstratedWeeks.length} week(s) were considered and none is marked as `
      + 'ABSORBED, so there is no week he has demonstrated he carries. A week nobody has '
      + 'judged does not raise a ceiling, because a higher ceiling licenses a bigger plan.',
    );
  }

  if (comparison.ceiling === null) {
    return failed(
      'the demand model found absorbed weeks but could not price any of them on '
      + `${comparison.basis}. ${comparison.reason}`,
    );
  }

  if (comparison.proposed === null) {
    return failed(
      `this athlete's ceiling is ${comparison.ceiling} equivalent easy miles on `
      + `${comparison.basis}, but the week being evaluated could not be priced on that same `
      + `basis${unknownComponents.length > 0 ? ` (unknown: ${unknownComponents.join(', ')})` : ''}. `
      + 'Comparing a week priced one way against a ceiling priced another is the mixed-basis '
      + 'defect this model exists to prevent, so the week-level demand test does not run.',
    );
  }

  return measured({
    value: comparison.ceiling,
    basis: comparison.basis,
    context: req.context,
    fromWeekStartISO: comparison.from?.weekStartISO ?? null,
    consideredWeeks: comparison.considered,
    weeksWithoutContext: comparison.withoutContext,
    unknownComponents,
    detail:
      `Priced on ${comparison.basis} against his biggest absorbed week`
      + `${comparison.from ? ` (${comparison.from.weekStartISO})` : ''} of `
      + `${comparison.considered} considered. ${comparison.reason}`
      + (unknownComponents.length > 0
        ? ` Unknown components of the week being evaluated: ${unknownComponents.join(', ')}.`
        : ''),
  });
}
