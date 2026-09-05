/**
 * lib/adaptation/canonical/arbitration.ts · EVIDENCE IS INDEPENDENT, MUTATIONS
 * ARE NOT.
 *
 * `docs/ADAPTATION_ENGINE_CONTRACT.md`, the governing principle of the whole
 * document:
 *
 *     "Evidence is evaluated separately by lever, but every proposed change
 *      must survive recomposition of the complete plan."
 *
 * And the sentence the engine has to be able to say, which is this file's
 * acceptance test:
 *
 *     "Your threshold evidence supports a faster threshold pace, but this week
 *      already contains enough total demand, so the change is deferred until
 *      the next appropriate boundary."
 *
 *     "That is not one lever improperly suppressing another. It is independent
 *      evidence followed by coherent plan-level arbitration."
 *
 * ── THE FOUR RULES ─────────────────────────────────────────────────────────
 *
 * 1 · The COMPLETE PROJECTED WEEK, with the proposal applied, must not exceed
 *     this athlete's own demand ceiling. A lever that HELD is an INPUT to that
 *     projection, never the judgement itself.
 * 2 · (deleted 2026-09-04 — see below)
 * 3 · Prefer ONE MATERIAL lever per cycle, so the response stays attributable.
 *     Independent of rule 1 and asked in each lever's own doctrine units.
 * 4 · Record every suppressed proposal and why.
 *
 * ── WHAT CHANGED, AND WHY RULE 2 WAS DELETED RATHER THAN WIDENED ───────────
 *
 * Until 2026-09-04 rule 1 read "a volume or long-run HOLD suppresses changes
 * that materially increase the same week's total demand", and rule 2 carved an
 * exception out of it for a NON-MATERIAL pace correction. Two defects, one
 * cause:
 *
 *   · Rule 1 asked about the PROPOSAL'S SIZE while its own sentence is about
 *     THE WEEK ("this week already contains enough total demand"). One
 *     predicate answering two different questions is a Rule 16 violation, and
 *     it is the reason the two contract sentences appeared to conflict.
 *   · Rule 2's window was therefore keyed to materiality, which for the
 *     threshold lever is `3 s/mi x 0.5 = 1.5`, against an engine whose ordinary
 *     step is 3 and whose smallest step is 1. Live window: [1, 1.5) s/mi.
 *     MEASURED on the owner's whole history: fourteen threshold proposals, all
 *     of them the ordinary 3 s/mi, exception fired ZERO times, ten suppressed
 *     citing WEEKLY_VOLUME. Pinned as a defect by ARBREACH-1.
 *
 * Widening the window would have relocated the cliff rather than removed it,
 * which CLAUDE.md Rule 9 forbids in terms. Instead rule 1 now asks the question
 * its own sentence poses, and the behaviour rule 2 protected — "do not let one
 * unrelated HOLD freeze the entire engine" — is delivered by construction: a
 * HOLD is not a suppression trigger at all any more, so there is nothing left
 * to carve an exception out of. The owner's ruling, verbatim:
 *
 *     "Rule 1 should evaluate whether the complete week is at its
 *      athlete-specific demand ceiling; rule 3 should independently evaluate
 *      whether the proposed lever change is material."
 *
 * ── HOW A HOLD IS STILL AN INPUT ───────────────────────────────────────────
 *
 * A held lever proposes nothing, so the complete projected week carries that
 * lever AT ITS AUTHORED VALUE. That is the whole of its influence, and it is a
 * real one: the week is projected as it will actually be run. What a hold no
 * longer does is veto a different lever on its own authority. Where a load
 * lever did hold, the suppression note still names it in `by`, so a reader can
 * see the corroborating context without it having been the cause.
 *
 * ── WHERE THE CEILING NOW COMES FROM (changed 2026-09-04) ──────────────────
 *
 * Until this change `athleteCeilingWeeklyDemand` was a bare `Measured<number>`
 * and `canonical-shadow/live-input.ts` supplied it as `absent(...)`, so RULE 1
 * COULD NOT FIRE ON ANY LIVE EVALUATION. It was CLAUDE.md Rule 15's failure in
 * its purest form: a mechanism no case could reach, sitting behind a green
 * suite of fixtures that all supplied a ceiling by hand.
 *
 * `lib/plan/adjudication/weekly-demand.ts` is the demand model, and
 * `demand-ceiling.ts` is the seam onto it. Two things follow, and the second
 * matters more than the first:
 *
 *   · the ceiling is now a real reading of his own biggest ABSORBED week,
 *     priced on seven components where the data allows and on volume, quality
 *     and a flat long-run surcharge where it does not;
 *   · EVERY WEEK THIS FILE PROJECTS IS PRICED BY THE MODEL'S OWN FUNCTION, on
 *     the ceiling's own basis. There is no longer a three-term projection here
 *     being compared against a seven-component ceiling. `priceProjection` is
 *     the only place a week becomes a number, and it calls
 *     `priceWeekOnBasis`, which calls `priceProjectedWeek`, which calls
 *     `ceilingCostOf` — the model's one pricing door, and the same one the
 *     ceiling itself came out of. That is Rule 16 held by construction rather
 *     than by care.
 *
 * The old three-term scale in `plan-load.ts` is NOT a rival and is not
 * deleted: `weekly-demand.ts` imports its three coefficients, and on BASE_ONLY
 * against an unknown context the two produce the identical number. That
 * identity is asserted, not asserted-in-prose (Rule 20).
 *
 * ── RULE 11 · WHEN THE CEILING IS NOT KNOWN ────────────────────────────────
 *
 * The ceiling is still supplied by the caller, because "how much can this
 * athlete absorb in a week" belongs to the demand model and not here
 * (`docs/BRAIN_CONSTITUTION.md`, one question one owner). When it is not READ,
 * rule 1 CANNOT FIRE. That is the honest posture: an absent ceiling is not "no
 * ceiling" and it is not "at the ceiling".
 *
 * A missing input must never silently disable a safety mechanism, so the fact
 * is recorded loudly rather than assumed: `ArbitrationResult.demandCeiling`
 * carries the posture and its sentence, `evaluate.ts` puts it on every decision
 * record as `INV_DEMAND_CEILING_POSTURE_STATED`, and that invariant FAILS if a
 * week-ceiling suppression is ever emitted without a known ceiling.
 *
 * ── RULE 9 · WHY A CEILING IS NOT A CLIFF ──────────────────────────────────
 *
 * A ceiling is a threshold on a continuous quantity, which is the shape Rule 9
 * is about, so it is worth saying exactly why this one is admissible.
 *
 *   · The response is MONOTONE by construction. More headroom never makes a
 *     proposal less likely to proceed, and a larger proposal never makes it
 *     more likely. The signature Rule 9 names — "the fitter runner gets the
 *     worse plan" — cannot occur here, and `_arbitration_reading_c.test.ts`
 *     walks the ceiling across the boundary in small steps and asserts it.
 *   · The consequence either side of the line is APPLY versus DEFER-AND-QUEUE,
 *     never APPLY versus LOSE. `deferral-queue.ts` is what makes that true: a
 *     proposal that lands a hair over the ceiling is reconsidered at the next
 *     boundary against fresh evidence. A hair of input therefore buys a week of
 *     delay, not a categorically different plan.
 *   · `DEMAND_CEILING_EPSILON` handles representation only, so a week stated as
 *     sitting exactly AT its ceiling is at it rather than over it.
 *
 * ── PRIORITY · PHASE-AWARE SINCE 2026-09-05, AND WHY THE CONSTANT WENT ─────
 *
 * This header used to justify a STATIC global constant,
 * `ARBITRATION_PRIORITY = ['WEEKLY_VOLUME', 'LONG_RUN', 'THRESHOLD_PACE']`,
 * citing PROGRESSIVE_BASELINE_DOCTRINE.md Q8's "Duration is the primary early
 * lever. Pace moves in smaller increments."
 *
 * Q8's heading is "Marathon-effort progression in the baseline" and that
 * sentence sits under the row "Early marathon-specific work". It is a claim
 * about the EARLY part of a block, and the constant applied it to every phase
 * including the TAPER, where the same document says the opposite: "Taper by
 * removing fatigue, not by completing unfinished development."
 *
 * The order now comes from `phase-priority.ts`, which resolves it from the
 * authored phase, the goal event, the current limiter, the safety posture and
 * the steps already taken this cycle — every one of them an enum or an integer
 * count, so there is no continuous quantity left in the ordering for Rule 9's
 * hair to move. `ArbitrationInput.priority` is that resolution, and this file
 * reads it rather than deriving one.
 *
 * The old order survives as the PHASE-NEUTRAL one, on the citation that
 * actually is phase-neutral: "Progress strong capacities mainly through
 * workload before moving their pace" (governing principles), with weekly volume
 * before the long run because the contract makes the long run's validity DEPEND
 * on weekly volume ("Coherent with weekly volume") and a dependency settles the
 * order. It is used for BASE, MAINTENANCE, and — labelled as such — for an
 * UNKNOWN phase.
 *
 * The order decides which proposal is priced against a week that already
 * carries the others, since rule 1 projects CUMULATIVELY. So the loser of an
 * ordering is DEFERRED AND QUEUED, never lost.
 *
 * ── RULE 5 (2026-09-05) · A PHASE MAY DECLINE, AND THE OBJECTIVE SAYS SO ───
 *
 * A taper or a recovery block declines every proposal that raises the week's
 * demand, and a taper additionally freezes the threshold anchor in BOTH
 * directions ("preserve the most recently supported effort; no large new pace
 * jump"). A safety hard stop declines everything.
 *
 * This is NOT a second rule invented here. `lib/brain/objective.ts` already
 * ranks `PRESCRIBED_RECOVERY` and `HARD_STOP` above a SUPPORTED push, and
 * `phaseDeclineFor` returns exactly one of those two bases. `rule5Suppresses`
 * runs the justification back through `phaseDeclineObjection`, which is
 * `objectionToChoice` — so the admissibility of the decline is decided by the
 * objective's own function and not by this file agreeing with itself.
 *
 * ── RULE 22 · WHAT THIS FILE'S GATE CANNOT FAIL ON ─────────────────────────
 *
 * · It cannot fail on the CEILING ITSELF BEING WRONG. A ceiling 20% too
 *   generous would pass the entire suite while letting through weeks no runner
 *   should be asked to carry. That number belongs to the demand model, whose
 *   five POLICY_ASSUMPTION coefficients nobody has calibrated, and this engine
 *   has no way to check it. Wiring the model in made the ceiling REAL; it did
 *   not make it RIGHT, and those are different claims.
 * · It cannot fail on the BASIS being weaker than it should be. A live
 *   evaluation that degrades to BASE_ONLY because one absorbed week's context
 *   could not be reconstructed produces a legal, well-formed, narrower
 *   comparison, and the only thing that says so is the `basis` field a reader
 *   has to look at.
 * · It cannot fail on the materiality threshold being set wrong. Every test
 *   here constructs proposals that are clearly above or clearly below the bar.
 * · It cannot fail on the plan-load coefficients. Only ordering and sign are
 *   read, so any monotonic set passes.
 * · It cannot fail on the PHASE ORDER being the wrong coaching answer. Every
 *   row of `PHASE_POLICY` is quoted from a research table or labelled
 *   POLICY_ASSUMPTION, and a gate can check that the quote resolves and that
 *   the label is there. Nothing can check that the order coaches better.
 * · It cannot fail on the PHASE BEING MISLABELLED upstream. The phase is read
 *   off the authored plan; a race-specific block stamped BASE is invisible here.
 */
import {
  DEMAND_CEILING_EPSILON,
  MATERIAL_SHARE_OF_ORDINARY_STEP,
  MAX_MATERIAL_LEVERS_PER_CYCLE,
  THRESHOLD_ORDINARY_STEP_SEC_PER_MI,
  VOLUME_MAX_STEP_FRAC,
  LONG_RUN_MAX_STEP_MI,
} from './contract-constants';
import type { CanonicalLever, Measured } from './input';
import type {
  DecisionLedger, LedgerOption, LedgerOptionEntry, SuppressionNote,
} from './decision-record';
import { NON_MOVING_DECISIONS } from './decision-record';
import type { LeverVerdict } from './levers/shared';
import { demandDeltaShare, type ProjectedPlanLoad } from './plan-load';
import {
  priceWeekOnBasis,
  priceWeekWithoutCeiling,
  type AthleteWeeklyDemandCeiling,
  type CeilingBasis,
} from './demand-ceiling';
import { phaseDeclineFor, phaseDeclineObjection, type ResolvedPriority } from './phase-priority';
/* The codebase's ONE owner of how a distance is written down. */
import { miText } from './levers/shared';

/**
 * The PHASE-NEUTRAL order, and the only one this file still names.
 *
 * It is not a priority any more: `phase-priority.ts` resolves the live order
 * and this is simply the sequence used to break a tie deterministically when
 * two levers are otherwise equal, and to keep `LEGACY_HOLD_PRESENCE`'s
 * counterfactual reproducing the pre-2026-09-04 rule exactly.
 *
 * Cited to the phase-neutral sentence rather than to Q8's early-block one:
 * "Progress strong capacities mainly through workload before moving their
 * pace" (PROGRESSIVE_BASELINE_DOCTRINE.md, governing principles), with weekly
 * volume before the long run because the long run's validity DEPENDS on weekly
 * volume ("Coherent with weekly volume").
 */
export const PHASE_NEUTRAL_ORDER: readonly CanonicalLever[] = [
  'WEEKLY_VOLUME',
  'LONG_RUN',
  'THRESHOLD_PACE',
];

/**
 * The two readings of rule 1 this engine can run.
 *
 * `WEEK_DEMAND_CEILING` is the live one and the only one any production caller
 * may pass. `LEGACY_HOLD_PRESENCE` reproduces the pre-2026-09-04 rule exactly,
 * and exists for ONE reason: `_counterfactual.script.ts` has to replay the
 * owner's real history through both to measure what the change actually did.
 * Rule 21's standard is that an upward path be PROVEN to fire on real history,
 * and that proof needs the before as well as the after.
 *
 * It is not a fallback, a flag, or a migration path. `_arbitration_reading_c
 * .test.ts` asserts by scanning source that the counterfactual script is the
 * only caller that names it, so this cannot quietly become a second live
 * engine — which is exactly the "legacy path left as a comment someone will
 * call anyway" that `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md`
 * forbids.
 */
export type ArbitrationReading = 'WEEK_DEMAND_CEILING' | 'LEGACY_HOLD_PRESENCE';

/**
 * What the engine knows about this athlete's weekly demand ceiling, and what
 * that means for rule 1. Rule 11's three facts, as a union whose refusal
 * branches carry no `value` field, so a caller cannot read a ceiling that is
 * not there without the compiler stopping them.
 */
export type DemandCeilingPosture =
  | {
    readonly kind: 'READ';
    readonly value: number;
    /**
     * Which component set BOTH sides of the comparison were priced on. Carried
     * onto every decision record, because "at the ceiling on all six
     * components" and "at the ceiling on volume, quality and a flat long-run
     * surcharge" are different findings and a reader is entitled to know
     * which one suppressed a progression.
     */
    readonly basis: CeilingBasis;
    /** The absorbed week the ceiling was measured from. */
    readonly fromWeekStartISO: string | null;
    /**
     * Components of the projected week the demand model could not compute.
     * Empty is a measured "all seven priced"; a non-empty list is Rule 11's
     * unknown, carried where a reader will actually see it.
     */
    readonly unknownComponents: readonly string[];
    /** Whether rule 1 was able to run at all. */
    readonly rule1CanFire: true;
    readonly detail: string;
  }
  | {
    readonly kind: 'ABSENT' | 'FAILED';
    readonly rule1CanFire: false;
    readonly detail: string;
  };

export interface ArbitrationInput {
  readonly verdicts: readonly LeverVerdict[];
  /** Which week this is. Identifies the week the demand model prices. */
  readonly baseWeekStartISO: string;
  /** The week a proposal would first affect, as authored. */
  readonly baseWeeklyMi: number;
  readonly baseLongRunMi: number;
  readonly baseQualityMinutes: number;
  /**
   * The athlete's own ceiling on one week's total demand, WITH the basis it was
   * priced on and the week context every projection is priced in. Build one
   * with `resolveAthleteWeeklyDemandCeiling` in `demand-ceiling.ts`. Owned by
   * the demand model, not by this file.
   *
   * When it is READ, every week this file projects is priced through
   * `priceWeekOnBasis` against exactly these terms, so the two sides of rule
   * 1's comparison are the same arithmetic by construction. When it is not,
   * the projections fall back to `priceWeekWithoutCeiling`, which is the same
   * pricing door read on BASE_ONLY against an unknown context — a narrower
   * reading of one function, not a second scale.
   */
  readonly athleteCeilingWeeklyDemand: Measured<AthleteWeeklyDemandCeiling>;
  /** Where a deferred proposal would next be reconsidered. */
  readonly nextBoundaryISO: string | null;
  /**
   * The phase-aware lever order and posture for THIS evaluation, resolved by
   * `phase-priority.ts`. Owned there, read here.
   */
  readonly priority: ResolvedPriority;
  /** Defaults to the live reading. See `ArbitrationReading`. */
  readonly reading?: ArbitrationReading;
}

export interface ArbitratedVerdict {
  readonly verdict: LeverVerdict;
  /** Null when the proposal survived arbitration. */
  readonly suppressedBy: SuppressionNote | null;
  /** Share of projected weekly demand this proposal moves. */
  readonly demandShare: number;
  readonly material: boolean;
  /** The three options, costed. See `DecisionLedger`. */
  readonly ledger: DecisionLedger;
}

export interface ArbitrationResult {
  readonly arbitrated: readonly ArbitratedVerdict[];
  readonly baseLoad: ProjectedPlanLoad;
  /** The load projection with every SURVIVING proposal applied together. */
  readonly combinedLoad: ProjectedPlanLoad;
  readonly combinedShare: number;
  /** Rule 11 · stated on every result, whether or not rule 1 could run. */
  readonly demandCeiling: DemandCeilingPosture;
  readonly reading: ArbitrationReading;
}

/**
 * Is this proposal material, in the lever's OWN doctrine units?
 *
 * Rule 3 only. Half the lever's ordinary step, per
 * `MATERIAL_SHARE_OF_ORDINARY_STEP`, whose header explains why this is not a
 * share of weekly load.
 */
function isMaterial(v: LeverVerdict, input: ArbitrationInput): boolean {
  if (v.proposedAfterValue === null) return false;
  const delta = Math.abs(v.proposedAfterValue - v.beforeValue);

  if (v.lever === 'THRESHOLD_PACE') {
    return delta >= THRESHOLD_ORDINARY_STEP_SEC_PER_MI * MATERIAL_SHARE_OF_ORDINARY_STEP;
  }
  if (v.lever === 'WEEKLY_VOLUME') {
    const ordinary = input.baseWeeklyMi * VOLUME_MAX_STEP_FRAC;
    return delta >= ordinary * MATERIAL_SHARE_OF_ORDINARY_STEP;
  }
  return delta >= LONG_RUN_MAX_STEP_MI * MATERIAL_SHARE_OF_ORDINARY_STEP;
}

/**
 * The four quantities the levers move, with a set of verdicts applied together.
 *
 * Separated from the PRICING below because the two are different questions:
 * this one is "what does the week become", and pricing is "what does that
 * cost". Only the second belongs to the demand model.
 */
interface ProjectedWeek {
  readonly weeklyMi: number;
  readonly longRunMi: number;
  readonly qualityMinutes: number;
  /** Signed, against the anchor the plan was authored at. Negative is faster. */
  readonly thresholdAnchorDeltaSecPerMi: number;
}

function weekWithMany(
  input: ArbitrationInput,
  verdicts: readonly LeverVerdict[],
): ProjectedWeek {
  let weekly = input.baseWeeklyMi;
  let long = input.baseLongRunMi;
  let paceDelta = 0;

  for (const v of verdicts) {
    if (v.proposedAfterValue === null) continue;
    if (v.lever === 'WEEKLY_VOLUME') weekly = v.proposedAfterValue;
    if (v.lever === 'LONG_RUN') {
      // A longer long run adds its extra miles to the week as well as carrying
      // its own surcharge. Modelling it as a pure substitution would make the
      // long-run lever look free, which is the opposite of true.
      weekly = weekly + (v.proposedAfterValue - v.beforeValue);
      long = v.proposedAfterValue;
    }
    if (v.lever === 'THRESHOLD_PACE') paceDelta = v.proposedAfterValue - v.beforeValue;
  }

  return {
    weeklyMi: weekly,
    longRunMi: long,
    qualityMinutes: input.baseQualityMinutes,
    thresholdAnchorDeltaSecPerMi: paceDelta,
  };
}

/**
 * PRICE a projected week, ON THE CEILING'S OWN TERMS.
 *
 * The one place in this file a week becomes a number. When a ceiling is READ
 * the pricing runs through `priceWeekOnBasis` against that ceiling's basis and
 * context, so rule 1 compares like with like by construction. When it is not,
 * `priceWeekWithoutCeiling` reads the same demand-model door on BASE_ONLY —
 * one pricing function, read two ways, never two scales.
 *
 * RULE 11 · a week the model REFUSES to price is not a week that costs
 * nothing, so this throws rather than returning a number. The branch is
 * unreachable through `resolveAthleteWeeklyDemandCeiling`, which proves the
 * base week prices on the ceiling's basis before handing the ceiling over. It
 * is written as a real branch anyway, because a caller may build a ceiling by
 * hand, and a zero or a NaN travelling into a decision record as "demand" is
 * exactly the collapse this engine exists to make impossible.
 */
function priceProjection(
  ceiling: Measured<AthleteWeeklyDemandCeiling>,
  weekStartISO: string,
  week: ProjectedWeek,
): ProjectedPlanLoad {
  const priced = ceiling.ok
    ? priceWeekOnBasis(ceiling.value, week)
    : priceWeekWithoutCeiling(weekStartISO, week);

  if (priced === null) {
    throw new Error(
      'arbitrate: the demand model refused to price the projected week on the ceiling\'s '
      + `own basis (${ceiling.ok ? ceiling.value.basis : 'BASE_ONLY'}). A ceiling that cannot `
      + 'price the week it governs is half a comparison; build it with '
      + 'resolveAthleteWeeklyDemandCeiling, which refuses instead of returning one.',
    );
  }

  return {
    weeklyMi: week.weeklyMi,
    longRunMi: week.longRunMi,
    qualityMinutes: week.qualityMinutes,
    demandIndex: Math.round(priced * 1000) / 1000,
  };
}

/** Rule 11, resolved once, so no branch below has to get it right on its own. */
function ceilingPostureOf(m: Measured<AthleteWeeklyDemandCeiling>): DemandCeilingPosture {
  if (m.ok) {
    return {
      kind: 'READ',
      value: m.value.value,
      basis: m.value.basis,
      fromWeekStartISO: m.value.fromWeekStartISO,
      unknownComponents: m.value.unknownComponents,
      rule1CanFire: true,
      detail:
        `The athlete's weekly demand ceiling stands at ${m.value.value} equivalent easy `
        + `miles, priced on ${m.value.basis}. The complete projected week is priced by the `
        + `same function on the same basis and measured against it. ${m.value.detail}`,
    };
  }
  if (m.why.kind === 'FAILED') {
    return {
      kind: 'FAILED',
      rule1CanFire: false,
      detail:
        `The read of this athlete's weekly demand ceiling failed: ${m.why.what}. `
        + 'A failed read is not a ceiling of zero and it is not an absence of one, so the '
        + 'week-level demand test did not run on this evaluation and nothing was deferred '
        + 'for total demand.',
    };
  }
  const what = m.why.kind === 'ABSENT' ? m.why.what : 'no reason recorded';
  return {
    kind: 'ABSENT',
    rule1CanFire: false,
    detail:
      `No weekly demand ceiling was supplied for this athlete: ${what}. `
      + 'That is not the same as having no ceiling and it is not the same as being at one, '
      + 'so the week-level demand test did not run on this evaluation and nothing was '
      + 'deferred for total demand.',
  };
}

export function arbitrate(input: ArbitrationInput): ArbitrationResult {
  const reading: ArbitrationReading = input.reading ?? 'WEEK_DEMAND_CEILING';
  const ceiling = ceilingPostureOf(input.athleteCeilingWeeklyDemand);

  /** Every projection in this function goes through here. One scale (Rule 16). */
  const price = (verdicts: readonly LeverVerdict[]): ProjectedPlanLoad =>
    priceProjection(
      input.athleteCeilingWeeklyDemand,
      input.baseWeekStartISO,
      weekWithMany(input, verdicts),
    );

  const baseLoad = price([]);

  /* ── Materiality, one proposal at a time. Rule 3's question only ───────── */

  const scored = input.verdicts.map((verdict) => {
    const moves = !NON_MOVING_DECISIONS.has(verdict.decision);
    const share = moves ? demandDeltaShare(baseLoad, price([verdict])) : 0;
    return {
      verdict,
      demandShare: Math.round(share * 10_000) / 10_000,
      material: moves && isMaterial(verdict, input),
    };
  });

  /* ── The held load lever · an INPUT to rule 1, never the judgement ─────── */

  const held = scored.find(
    (s) =>
      (s.verdict.lever === 'WEEKLY_VOLUME' || s.verdict.lever === 'LONG_RUN')
      && (s.verdict.decision === 'HOLD' || s.verdict.decision === 'REGRESS'),
  );
  const heldLever: CanonicalLever | 'PLAN_LOAD' = held?.verdict.lever ?? 'PLAN_LOAD';
  const heldRank = held ? PHASE_NEUTRAL_ORDER.indexOf(held.verdict.lever) : Infinity;

  const out: ArbitratedVerdict[] = [];
  let materialAccepted = 0;

  /**
   * The live priority. PHASE-AWARE, and resolved by `phase-priority.ts` rather
   * than by a constant here.
   *
   * `LEGACY_HOLD_PRESENCE` deliberately keeps the phase-neutral order, because
   * its only job is to reproduce the pre-2026-09-04 engine for the
   * counterfactual, and that engine had no phase.
   */
  const order = reading === 'LEGACY_HOLD_PRESENCE'
    ? PHASE_NEUTRAL_ORDER
    : input.priority.order;

  // Ties broken by the phase-neutral order so the sort is total and stable even
  // if a future resolver ever returned a partial one.
  const rank = (l: CanonicalLever): number => {
    const i = order.indexOf(l);
    return i >= 0 ? i : order.length + PHASE_NEUTRAL_ORDER.indexOf(l);
  };
  const ordered = [...scored].sort((a, b) => rank(a.verdict.lever) - rank(b.verdict.lever));

  /** Everything accepted so far. Rule 1 projects the week including these. */
  const accepted: LeverVerdict[] = [];

  for (const s of ordered) {
    const moves = !NON_MOVING_DECISIONS.has(s.verdict.decision);
    const increasesDemand = s.demandShare > 0;

    /* ── Rule 5 · the PHASE may decline, before anything else is asked ─────
     *
     * First, because a taper declining a push is not a load arbitration and
     * should not be reported as one. `phaseDeclineFor` returns the
     * justification and `phaseDeclineObjection` — which is the objective's own
     * `objectionToChoice` — decides whether the objective permits it. A
     * justification the objective rejects is NOT applied: this engine may not
     * invent a decline the governing objective does not allow.
     */
    const phaseDecline = phaseDeclineFor({
      priority: input.priority,
      lever: s.verdict.lever,
      increasesDemand,
      moves,
    });
    const declineAdmissible = phaseDecline !== null
      && phaseDeclineObjection(phaseDecline) === null;

    if (phaseDecline !== null && declineAdmissible) {
      const note: SuppressionNote = {
        by: 'PLAN_LOAD',
        rule: phaseDecline.basis === 'HARD_STOP' ? 'SAFETY_HARD_STOP' : 'PHASE_PRESCRIBES_RECOVERY',
        detail:
          `The ${label(s.verdict.lever)} evidence supports this change, but ${phaseDecline.because}. `
          + `${phaseDecline.wouldAdvanceIf}`,
        // A hard stop lifts when Safety says so, not at a boundary this engine
        // can schedule against. Rule 11: "no scheduled reconsideration" is a
        // fact, and a date invented here would be a worse one.
        reconsiderAtISO: phaseDecline.basis === 'HARD_STOP' ? null : input.nextBoundaryISO,
      };
      out.push({ ...s, suppressedBy: note, ledger: buildLedger({ input, price, s, accepted, ceiling, suppressedBy: note }) });
      continue;
    }

    // A verdict that proposes nothing cannot be suppressed. It is already the
    // engine's answer, and recording it as "suppressed" would be a lie.
    if (!moves) {
      out.push({ ...s, suppressedBy: null, ledger: buildLedger({ input, price, s, accepted, ceiling, suppressedBy: null }) });
      continue;
    }

    /* ── Rule 1 · is the COMPLETE PROJECTED WEEK at the athlete's ceiling ── */

    if (rule1Suppresses({ price, reading, ceiling, s, accepted, increasesDemand, heldLever, heldRank, order })) {
      const note: SuppressionNote = {
        by: heldLever,
        rule: 'WEEK_AT_DEMAND_CEILING',
        detail:
          `The ${label(s.verdict.lever)} evidence supports this change, but this week already `
          + 'contains enough total demand, so the change is deferred until the next '
          + 'appropriate boundary.',
        reconsiderAtISO: input.nextBoundaryISO,
      };
      out.push({ ...s, suppressedBy: note, ledger: buildLedger({ input, price, s, accepted, ceiling, suppressedBy: note }) });
      continue;
    }

    /* ── Rule 3 · one material lever per cycle, independently ──────────────
     *
     * Attributability, and nothing else. It no longer shares a predicate with
     * rule 1, so a week with room can still take a material pace correction,
     * and a full week still defers one even if nothing else moved.
     */
    if (s.material) {
      if (materialAccepted >= MAX_MATERIAL_LEVERS_PER_CYCLE) {
        const note: SuppressionNote = {
          by: 'PLAN_LOAD',
          rule: 'ONE_MATERIAL_LEVER_PER_CYCLE',
          detail:
            'Another lever is already making a material change this cycle. Making both at '
            + 'once would leave the response impossible to attribute, so this one is '
            + 'deferred until the next appropriate boundary.',
          reconsiderAtISO: input.nextBoundaryISO,
        };
        out.push({ ...s, suppressedBy: note, ledger: buildLedger({ input, price, s, accepted, ceiling, suppressedBy: note }) });
        continue;
      }
      materialAccepted += 1;
    }

    // The ledger is priced BEFORE this verdict joins `accepted`, so its
    // whole-sequence cost describes the week with everything already accepted
    // PLUS this option — the same projection rule 1 used.
    const ledger = buildLedger({ input, price, s, accepted, ceiling, suppressedBy: null });
    accepted.push(s.verdict);
    out.push({ ...s, suppressedBy: null, ledger });
  }

  /* ── The combined projection of everything that survived ───────────────── */

  const combinedLoad = price(accepted);

  // Restore the caller's original ordering so a reader sees the levers in the
  // order they were evaluated, not the order they were arbitrated in.
  const byLever = new Map(out.map((o) => [o.verdict.lever, o]));
  const arbitrated = input.verdicts.map((v) => {
    const found = byLever.get(v.lever);
    if (found === undefined) {
      // Unreachable while `out` is built from `input.verdicts`, and written as
      // a real branch rather than a non-null assertion so a future caller that
      // passes two verdicts for one lever gets an honest failure instead of a
      // silent undefined travelling into a decision record.
      throw new Error(`arbitrate: no arbitrated verdict for lever ${v.lever}`);
    }
    return found;
  });

  return {
    arbitrated,
    baseLoad,
    combinedLoad,
    combinedShare: Math.round(demandDeltaShare(baseLoad, combinedLoad) * 10_000) / 10_000,
    demandCeiling: ceiling,
    reading,
  };
}

/**
 * Rule 1, both readings, in one place so the counterfactual compares two
 * predicates rather than two engines.
 *
 * READING C (`WEEK_DEMAND_CEILING`) · project the complete week with everything
 * already accepted this cycle PLUS this proposal, and ask whether that week
 * exceeds the athlete's ceiling. A proposal that lowers demand is never
 * suppressed by a ceiling. An unknown ceiling means the test cannot run.
 *
 * THE LEGACY READING (`LEGACY_HOLD_PRESENCE`) · the pre-2026-09-04 rule,
 * verbatim: a load-lever HOLD suppressed any MATERIAL demand increase on a
 * lever further down the priority order. Kept only for the counterfactual,
 * and reachable only from `_counterfactual.script.ts`.
 */
function rule1Suppresses(args: {
  /** The one pricing door. Passed in so this function cannot open a second. */
  price: (verdicts: readonly LeverVerdict[]) => ProjectedPlanLoad;
  reading: ArbitrationReading;
  ceiling: DemandCeilingPosture;
  s: { verdict: LeverVerdict; demandShare: number; material: boolean };
  accepted: readonly LeverVerdict[];
  increasesDemand: boolean;
  heldLever: CanonicalLever | 'PLAN_LOAD';
  heldRank: number;
  /** The live order. The legacy reading deliberately uses the phase-neutral one. */
  order: readonly CanonicalLever[];
}): boolean {
  const { price, reading, ceiling, s, accepted, increasesDemand, heldLever, heldRank } = args;

  if (reading === 'LEGACY_HOLD_PRESENCE') {
    // The pre-2026-09-04 engine had no phase, so its rank is read off the
    // phase-neutral order and never off the live one. A counterfactual that
    // fed the new ordering into the old rule would be comparing two changes
    // at once and could not attribute either.
    const rank = PHASE_NEUTRAL_ORDER.indexOf(s.verdict.lever);
    return heldLever !== 'PLAN_LOAD'
      && increasesDemand
      && s.material
      && s.verdict.lever !== heldLever
      && rank > heldRank;
  }

  // Rule 11 · an unknown ceiling cannot suppress anything. The fact is carried
  // out on `ArbitrationResult.demandCeiling` and asserted by an invariant on
  // every record, so it is stated rather than silently absorbed.
  if (!ceiling.rule1CanFire) return false;
  if (!increasesDemand) return false;

  const projected = price([...accepted, s.verdict]);
  return projected.demandIndex > ceiling.value + DEMAND_CEILING_EPSILON;
}

function label(l: CanonicalLever): string {
  if (l === 'THRESHOLD_PACE') return 'threshold';
  if (l === 'WEEKLY_VOLUME') return 'weekly volume';
  return 'long run';
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE OPTION LEDGER
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The units a lever's ordinary doctrine step is written in, and the bound.
 *
 * Read from `contract-constants.ts` rather than restated, so a PULL_BACK is
 * costed at exactly the step size the lever itself would move (Rule 16).
 */
function ordinaryStepOf(lever: CanonicalLever, input: ArbitrationInput): {
  readonly step: number;
  readonly unit: string;
  readonly constant: string;
} {
  if (lever === 'THRESHOLD_PACE') {
    return {
      step: THRESHOLD_ORDINARY_STEP_SEC_PER_MI,
      unit: 's/mi',
      constant: 'THRESHOLD_ORDINARY_STEP_SEC_PER_MI',
    };
  }
  if (lever === 'WEEKLY_VOLUME') {
    return {
      // NOT rounded here. `lib/format/run.ts` is this codebase's one owner of
      // how a distance is written down, and a second rounding rule spelled in
      // this file is the Rule 16 defect `_format_lint.test.ts` exists to catch.
      // The number stays exact for the arithmetic below and is FORMATTED where
      // it is printed.
      step: input.baseWeeklyMi * VOLUME_MAX_STEP_FRAC,
      unit: 'mi/week',
      constant: 'VOLUME_MAX_STEP_FRAC',
    };
  }
  return { step: LONG_RUN_MAX_STEP_MI, unit: 'mi', constant: 'LONG_RUN_MAX_STEP_MI' };
}

/**
 * A hypothetical verdict, for costing an option the levers did not propose.
 *
 * The PULL_BACK option has to be priced even when no lever proposed one, or
 * the ledger would only ever cost the options the engine already liked — which
 * is the shape Rule 22 warns about: a comparison that cannot fail on the side
 * nobody wrote it for. Only `lever`, `beforeValue` and `proposedAfterValue` are
 * read by `weekWithMany`, so the rest is filled from the real verdict.
 */
function hypothetical(v: LeverVerdict, after: number): LeverVerdict {
  return { ...v, proposedAfterValue: after };
}

/**
 * THE THREE OPTIONS, COSTED · every material decision's working, persisted.
 *
 * PUSH is the lever's own proposal where it made one, and its ordinary
 * doctrine step where it did not — because "what would pushing have cost" is
 * exactly the question a HOLD record has to be able to answer, and a ledger
 * that left PUSH blank on every HOLD would reproduce the ambiguity Rule 21
 * measured (an engine that never pushes, indistinguishable from a runner who
 * never earned it).
 *
 * HOLD is the week as authored. PULL_BACK is one ordinary step the other way.
 * All three are priced through the SAME `price` closure the rules use, on the
 * ceiling's own basis, so the three numbers are comparable with each other and
 * with the ceiling (Rule 16).
 */
function buildLedger(args: {
  input: ArbitrationInput;
  price: (verdicts: readonly LeverVerdict[]) => ProjectedPlanLoad;
  s: { verdict: LeverVerdict; demandShare: number; material: boolean };
  accepted: readonly LeverVerdict[];
  ceiling: DemandCeilingPosture;
  suppressedBy: SuppressionNote | null;
}): DecisionLedger {
  const { input, price, s, accepted, ceiling, suppressedBy } = args;
  const v = s.verdict;
  const p = input.priority;
  const step = ordinaryStepOf(v.lever, input);
  const faster = v.lever === 'THRESHOLD_PACE';

  /**
   * Rule 11 · a week the model refuses to price is not a week that costs
   * nothing. `price` throws in that case, and a ledger entry is not worth
   * aborting an evaluation for, so the refusal is CAUGHT and RECORDED as a
   * null with its reason rather than swallowed as a zero.
   */
  const cost = (verdicts: readonly LeverVerdict[]): { value: number | null; basis: string } => {
    try {
      const priced = price(verdicts);
      return {
        value: priced.demandIndex,
        basis: ceiling.kind === 'READ'
          ? `Priced on ${ceiling.basis} against a ceiling of ${ceiling.value}.`
          : `Priced on BASE_ONLY. ${ceiling.detail}`,
      };
    } catch (e) {
      return {
        value: null,
        basis: `The demand model refused to price this week: ${e instanceof Error ? e.message : String(e)}. `
          + 'That is not a week that costs nothing.',
      };
    }
  };

  const pushAfter = v.proposedAfterValue !== null && v.decision === 'PROGRESS'
    ? v.proposedAfterValue
    : faster ? v.beforeValue - step.step : v.beforeValue + step.step;
  const pullAfter = faster ? v.beforeValue + step.step : Math.max(0, v.beforeValue - step.step);

  const pushCost = cost([...accepted, hypothetical(v, pushAfter)]);
  const holdCost = cost(accepted);
  const pullCost = cost([...accepted, hypothetical(v, pullAfter)]);

  const athleteEvidence = `${v.confidence.sentence} `
    + `${v.confidence.supportingCount} supporting and ${v.confidence.contradictingCount} `
    + `contradicting observations over ${v.confidence.windowDays} days`
    + `${v.confidence.limitation === null ? '' : `. ${v.confidence.limitation}`}`;

  const researchAllowance = v.magnitude === null
    ? `${step.constant} allows an ordinary step of ${step.step} ${step.unit} for this lever. `
      + 'No proposal was made, so no bound was spent.'
    : `${v.magnitude.limitConstant} bounds this lever at ${v.magnitude.limit} `
      + `${v.magnitude.unit}. ${v.magnitude.limitCitation}`;

  const policyAssumptions: readonly string[] = [
    ...p.policyAssumptions,
    'No predicted-adaptation number is computed anywhere in this ledger. The expected '
    + 'benefit of each option is a sentence in the lever\'s own doctrine units, because no '
    + 'calibration data exists and a second uncalibrated score printed beside a measurement '
    + 'is exactly the defect the ranking-score rename was written for.',
  ];

  const unknowns: readonly string[] = [
    ...p.unknowns,
    ...(ceiling.kind === 'READ'
      ? ceiling.unknownComponents.map(
        (c) => `The demand model could not price the "${c}" component of the projected week.`)
      : [`The athlete's weekly demand ceiling is ${ceiling.kind}. ${ceiling.detail}`]),
  ];

  const entry = (
    option: LedgerOption,
    describe: string,
    expectedBenefit: string,
    c: { value: number | null; basis: string },
  ): LedgerOptionEntry => ({
    option,
    describe,
    wholeSequenceCost: c.value,
    wholeSequenceCostBasis: c.basis,
    expectedBenefit,
    athleteEvidence,
    researchAllowance,
    policyAssumptions,
    unknowns,
  });

  const options: readonly LedgerOptionEntry[] = [
    entry(
      'PUSH',
      `move ${label(v.lever)} from ${v.beforeValue} to ${pushAfter}`,
      faster
        ? `A threshold anchor ${Math.abs(pushAfter - v.beforeValue)} s/mi faster, repricing `
          + `${input.priority.phase === 'TAPER' ? 'the rehearsal sessions' : 'every future session of that type'}.`
        : `${miText(Math.abs(pushAfter - v.beforeValue))} more than the week as authored.`,
      pushCost,
    ),
    entry(
      'HOLD',
      `leave ${label(v.lever)} at ${v.beforeValue}`,
      'The week is run as authored. Holding is a real, frequent and correct state '
      + '(ADAPTATION_PROGRESSION_DOCTRINE.md), and where something else proposed to reduce '
      + 'the week, holding it is itself an advance.',
      holdCost,
    ),
    entry(
      'PULL_BACK',
      `move ${label(v.lever)} from ${v.beforeValue} to ${pullAfter}`,
      faster
        ? `A threshold anchor ${Math.abs(pullAfter - v.beforeValue)} s/mi slower, which buys `
          + 'recovery at the cost of the stimulus the sessions were written for.'
        : `${miText(Math.abs(pullAfter - v.beforeValue))} less than the week as authored.`,
      pullCost,
    ),
  ];

  const selected: LedgerOption =
    v.decision === 'PROGRESS' && suppressedBy === null ? 'PUSH'
      : v.decision === 'REGRESS' && suppressedBy === null ? 'PULL_BACK'
        : 'HOLD';

  const selectedBecause = suppressedBy === null
    ? v.reason
    : `${v.reason} ${suppressedBy.detail}`;

  return {
    options,
    selected,
    selectedBecause,
    reassessmentTrigger: {
      whenISO: suppressedBy === null ? input.nextBoundaryISO : suppressedBy.reconsiderAtISO,
      what: suppressedBy === null
        ? v.whatWouldChangeIt.join(' ') || 'The next weekly boundary, once the week\'s evidence has settled.'
        : suppressedBy.detail,
    },
    priority: {
      phase: p.phase,
      posture: p.posture,
      order: p.order,
      citations: p.citations.map((c) =>
        c.provenance === 'POLICY_ASSUMPTION'
          ? `POLICY_ASSUMPTION · ${c.says}`
          : `${c.doc} · "${c.anchor}" · ${c.says}`),
      why: p.why,
    },
  };
}
