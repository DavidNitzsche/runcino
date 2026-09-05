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
 * ── PRIORITY, AND ITS CITATION ─────────────────────────────────────────────
 *
 * When two material proposals compete, workload moves before pace:
 *
 *     "Progress strong capacities mainly through workload before moving their
 *      pace."          — PROGRESSIVE_BASELINE_DOCTRINE.md, governing principles
 *     "Duration is the primary early lever. Pace moves in smaller increments."
 *                      — Q8
 *
 * Weekly volume precedes the long run because Q22 makes the long run's validity
 * DEPEND on weekly volume ("Coherent with weekly volume"), and a dependency
 * settles the order: the quantity that constrains the other moves first. The
 * order also decides which proposal is priced against a week that already
 * carries the others, since rule 1 projects CUMULATIVELY.
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
import type { SuppressionNote } from './decision-record';
import { NON_MOVING_DECISIONS } from './decision-record';
import type { LeverVerdict } from './levers/shared';
import { demandDeltaShare, type ProjectedPlanLoad } from './plan-load';
import {
  priceWeekOnBasis,
  priceWeekWithoutCeiling,
  type AthleteWeeklyDemandCeiling,
  type CeilingBasis,
} from './demand-ceiling';

/**
 * Workload before pace. Volume before the long run that sits inside it.
 * Cited in the header; the order is not a preference.
 */
export const ARBITRATION_PRIORITY: readonly CanonicalLever[] = [
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
  const heldRank = held ? ARBITRATION_PRIORITY.indexOf(held.verdict.lever) : Infinity;

  const out: ArbitratedVerdict[] = [];
  let materialAccepted = 0;

  // Priority order, so which proposal survives is deterministic and cited, and
  // so the cumulative projection prices workload before pace.
  const ordered = [...scored].sort(
    (a, b) =>
      ARBITRATION_PRIORITY.indexOf(a.verdict.lever) - ARBITRATION_PRIORITY.indexOf(b.verdict.lever),
  );

  /** Everything accepted so far. Rule 1 projects the week including these. */
  const accepted: LeverVerdict[] = [];

  for (const s of ordered) {
    const moves = !NON_MOVING_DECISIONS.has(s.verdict.decision);

    // A verdict that proposes nothing cannot be suppressed. It is already the
    // engine's answer, and recording it as "suppressed" would be a lie.
    if (!moves) {
      out.push({ ...s, suppressedBy: null });
      continue;
    }

    const increasesDemand = s.demandShare > 0;

    /* ── Rule 1 · is the COMPLETE PROJECTED WEEK at the athlete's ceiling ── */

    if (rule1Suppresses({ price, reading, ceiling, s, accepted, increasesDemand, heldLever, heldRank })) {
      out.push({
        ...s,
        suppressedBy: {
          by: heldLever,
          rule: 'WEEK_AT_DEMAND_CEILING',
          detail:
            `The ${label(s.verdict.lever)} evidence supports this change, but this week already `
            + 'contains enough total demand, so the change is deferred until the next '
            + 'appropriate boundary.',
          reconsiderAtISO: input.nextBoundaryISO,
        },
      });
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
        out.push({
          ...s,
          suppressedBy: {
            by: 'PLAN_LOAD',
            rule: 'ONE_MATERIAL_LEVER_PER_CYCLE',
            detail:
              'Another lever is already making a material change this cycle. Making both at '
              + 'once would leave the response impossible to attribute, so this one is '
              + 'deferred until the next appropriate boundary.',
            reconsiderAtISO: input.nextBoundaryISO,
          },
        });
        continue;
      }
      materialAccepted += 1;
    }

    accepted.push(s.verdict);
    out.push({ ...s, suppressedBy: null });
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
}): boolean {
  const { price, reading, ceiling, s, accepted, increasesDemand, heldLever, heldRank } = args;

  if (reading === 'LEGACY_HOLD_PRESENCE') {
    const rank = ARBITRATION_PRIORITY.indexOf(s.verdict.lever);
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
