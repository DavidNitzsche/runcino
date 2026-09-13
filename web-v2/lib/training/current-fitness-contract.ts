/**
 * lib/training/current-fitness-contract.ts · PROPOSAL, NOT WIRED IN.
 *
 * WAVE 2, QUESTION 4 AND 5 · IS `ok: true` SUFFICIENT WHEN THE EVIDENCE
 * CARRIES CAVEATS, AND WHAT TYPE STOPS A CALLER READING `.vdot` WITHOUT
 * HANDLING THEM.
 *
 * Companion to `for external review/00-master-programme/reviews/
 * wave2-idempotency-proposal-2026-09-13.md`. Nothing here is imported by any
 * live job, cron, route or detector — proved by
 * `_wave2_no_mutation_scan.test.ts`, not by this sentence (Rule 20).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE FACT THAT PROMPTED THE QUESTION
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Re-measured against production on 2026-09-13, read-only, for the owner:
 *
 *   vdot 47.5 · pace 432 s/mi · confidence 0.772 · sourceMode `direct`
 *   reasons: DIRECT_CORROBORATED_THRESHOLD_EVIDENCE,
 *            THREE_RECENT_CORROBORATING_SESSIONS,
 *            OBSERVATIONS_AGREE,
 *            FRESH_EVIDENCE,
 *            REDUCED_AUTHORITY_EVIDENCE_IN_SUPPORT,
 *            NON_REPRESENTATIVE_EVIDENCE_IN_SUPPORT
 *
 * Four reasons that say the read is strong and two that say parts of it are
 * discounted, in one flat array, behind one boolean. A caller that reads
 * `.vdot` off that gets a number with no indication that any of it happened.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE CALL · `ok` DOES NOT BECOME FALSE FOR THESE TWO. THE TYPE CHANGES.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Both options were live and this is the argued choice, not a menu.
 *
 * ── WHY NOT `ok: false` ON REDUCED-AUTHORITY / NON-REPRESENTATIVE ──────────
 *
 * 1 · CONSTITUTION §14, VERBATIM: "Data quality modifies confidence, never
 *     creates alternate truth. Poor HR quality → HR-derived evidence
 *     confidence ↓. Never 'switch to an entirely different hidden training
 *     model.'" Both of these codes are emitted by `composeThresholdCapacity`
 *     from `direct.supporting.some(o => o.weight < 1)` and
 *     `.some(o => !o.representative)` — they describe observations whose
 *     WEIGHT was reduced, and that reduction is ALREADY PRICED into the
 *     `confidence` this same call returns. Refusing on top of it charges the
 *     same discount twice, and it does so by promoting a confidence fact into
 *     a truth fact, which is the exact move §14 forbids.
 * 2 · RULE 21, AND WHAT IT WOULD COST. These two codes are present on the
 *     owner's live, current, ordinary read. A rule that refuses on them
 *     refuses for the only real runner this app has, on a normal day, which
 *     makes the resolver inert by construction — "wired, tested and inert is
 *     this codebase's signature failure", and it is most damaging on the
 *     upward path.
 * 3 · CONSTITUTION §32: "UNKNOWN / LOW_CONFIDENCE / FALLBACK are legitimate
 *     states." LOW_CONFIDENCE is a state to be carried, not an error.
 *
 * ── WHY `ok: true` IS NEVERTHELESS NOT SUFFICIENT ──────────────────────────
 *
 * Rule 11, applied to the resolver's own output rather than to its inputs. A
 * clean read and a caveated read are two facts, and `ok: true` collapses
 * them. The failure that follows is not hypothetical — it is the shape of
 * every defect in Rule 11's own list: a caller reads a number that is
 * arithmetically correct, spends it, and nothing anywhere records that it was
 * spending a discounted one.
 *
 * So the answer is: **not a different boolean, a different TYPE.** `ok: true`
 * stays true and stops being enough to reach the numbers. See §5 below.
 *
 * ── AND THE COMBINATIONS THAT **DO** FORCE A REFUSAL ───────────────────────
 *
 * Two, and the line between them and the above is not "how weak" but WHICH
 * KIND OF FACT:
 *
 *   A CAVEAT THAT DISCOUNTS A REAL OBSERVATION is a confidence fact. §14.
 *   Qualified, never refused.
 *
 *   A CAVEAT THAT SAYS AN OBSERVATION COULD NOT BE READ, or that the
 *   observations CONTRADICT each other with nothing to break the tie, is a
 *   Rule 11 fact. There is no number to discount; there is an absence wearing
 *   a number's clothes. Refused.
 *
 *   · `EVIDENCE_ENGINE_READ_UNAVAILABLE` — emitted from
 *     `o.authority.evidenceKind === 'unavailable'`. The evidence engine could
 *     not classify the activity. "The read failed" and "the evidence is
 *     weak" are the two facts Rule 11 exists to keep apart, and this is
 *     literally the first of them.
 *   · `OBSERVATIONS_DISAGREE` **together with** `SPARSE_CORROBORATION` — the
 *     corpus contradicts itself AND has too few members to arbitrate. Either
 *     alone is a confidence fact and stays qualified: disagreement across a
 *     well-corroborated corpus is normal biological scatter, and sparseness
 *     with agreement is a small consistent story. It is the CONJUNCTION that
 *     has no honest reading. Stated as a conjunction on purpose — the pair
 *     appearing separately in real data must not be misread as this case.
 *
 * ── SYMMETRY IS AN ASSERTION, NOT AN INTENTION (RULE 21, RULE 22) ──────────
 *
 * The tier is computed from the reason codes ALONE. It cannot see, and must
 * never see, which direction the caller intends to move the runner. Rule 21:
 * "The bar to go UP may not be higher than the bar to come DOWN." A
 * caveat policy with a direction parameter is how that bar quietly becomes
 * asymmetric, so this file's functions take no direction argument at all and
 * `_current_fitness_contract.test.ts` asserts the tier is direction-blind by
 * construction.
 */
import type { CapacityReasonCode, SourceMode } from '@/lib/training/capacity-resolver';
import type {
  CurrentFitnessRead,
  CurrentFitnessProvenance,
  CurrentFitnessRefusalReason,
} from '@/lib/training/resolve-current-fitness';

/* ══════════════════════════════════════════════════════════════════════════
 * THE CAVEAT VOCABULARY
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Reason codes that are CAVEATS — a real observation counted for less than
 * face value. Confidence facts (§14). Qualified, never refused.
 *
 * Deliberately a small explicit list rather than "anything not in the good
 * list": a new `CapacityReasonCode` must be classified deliberately, and the
 * exhaustiveness gate in the test suite fails until it has been.
 */
export const QUALIFYING_CAVEATS: readonly CapacityReasonCode[] = Object.freeze([
  'REDUCED_AUTHORITY_EVIDENCE_IN_SUPPORT',
  'NON_REPRESENTATIVE_EVIDENCE_IN_SUPPORT',
  'SINGLE_SESSION_MOVE_CAPPED',
  'REEXAMINATION_LOWERED_THE_CORROBORATION_BAR',
  'SPARSE_CORROBORATION',
  'OBSERVATIONS_DISAGREE',
  'STALE_EVIDENCE',
  'DAY_TO_DAY_CONTINUITY_CAPPED',
  'CONTINUITY_UNAVAILABLE',
]);

/**
 * Reason codes that are NOT a discount but an ABSENCE. Rule 11 facts.
 * Refused on their own.
 */
export const DISQUALIFYING_CAVEATS: readonly CapacityReasonCode[] = Object.freeze([
  'EVIDENCE_ENGINE_READ_UNAVAILABLE',
]);

/**
 * Combinations that are individually qualifying and jointly disqualifying.
 * Each entry is an AND-set; a read carrying every member of any one entry is
 * refused.
 */
export const DISQUALIFYING_COMBINATIONS: readonly (readonly CapacityReasonCode[])[] = Object.freeze([
  Object.freeze(['OBSERVATIONS_DISAGREE', 'SPARSE_CORROBORATION'] as CapacityReasonCode[]),
]);

export type CaveatTier = 'CLEAN' | 'QUALIFIED' | 'DISQUALIFYING';

export interface CaveatAssessment {
  readonly tier: CaveatTier;
  /** Every qualifying caveat actually present, in the resolver's own order. */
  readonly caveats: readonly CapacityReasonCode[];
  /** Why the tier is what it is, in one sentence a human can read in a log. */
  readonly why: string;
}

/**
 * PURE, and DIRECTION-BLIND BY SIGNATURE (Rule 21). Classify a set of reason
 * codes.
 */
export function assessCaveats(reasons: readonly CapacityReasonCode[]): CaveatAssessment {
  const present = new Set(reasons);
  const caveats = reasons.filter((r) => QUALIFYING_CAVEATS.includes(r));

  const hardBlocker = reasons.find((r) => DISQUALIFYING_CAVEATS.includes(r));
  if (hardBlocker != null) {
    return {
      tier: 'DISQUALIFYING',
      caveats,
      why:
        `${hardBlocker} is not a weaker reading, it is a read that did not happen. Rule 11: a `
        + 'failed evidence read and weak evidence are two facts, and only one of them is a number.',
    };
  }

  for (const combo of DISQUALIFYING_COMBINATIONS) {
    if (combo.every((r) => present.has(r))) {
      return {
        tier: 'DISQUALIFYING',
        caveats,
        why:
          `${combo.join(' + ')} together: the corpus contradicts itself and has too few members `
          + 'to arbitrate. Either alone is a confidence fact and stays qualified; the conjunction '
          + 'has no honest reading.',
      };
    }
  }

  if (caveats.length === 0) {
    return { tier: 'CLEAN', caveats, why: 'no caveat was reported against this read.' };
  }
  return {
    tier: 'QUALIFIED',
    caveats,
    why:
      `${caveats.length} caveat(s) reported (${caveats.join(', ')}). Each discounts a real `
      + 'observation and each is already priced into the confidence returned beside it '
      + '(Constitution §14), so the read stands — but a caller may not spend the number without '
      + 'saying what it does about them.',
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * §5 · THE TYPED CALLER CONTRACT
 *
 * The numbers are NOT properties of the returned object. There is no `.vdot`
 * on `CurrentFitnessContract` to read, so a caller that ignores the caveats
 * does not get a slightly-wrong number — it does not compile.
 *
 * This is the pattern CLAUDE.md Rule 8 already names as the strongest
 * enforcement available in this codebase: `NormalReading<T>`'s refusal branch
 * "carries NO `value` field, so `reading.value` does not compile until the
 * caller branches. That makes Rule 11's zero-versus-refusal distinction a
 * type error rather than a discipline, which is the strongest enforcement
 * available and THE PATTERN TO COPY." This copies it and goes one step
 * further, because a discriminated union alone is not enough here: narrowing
 * to the `answered` branch would still hand over `.vdot` with the caveats
 * merely SITTING BESIDE IT, unread. Rule 11's own catalogue is full of
 * callers that had the information available and did not look.
 *
 * So the numbers live behind `withCurrentFitness(contract, handlers)`, whose
 * `onQualified` handler receives the caveats as a REQUIRED parameter. The
 * only route to the numbers passes through a function the caller had to write
 * that names them.
 * ═══════════════════════════════════════════════════════════════════════ */

/** The numbers, only ever handed to a handler — never a property of the
 *  contract object. */
export interface CurrentFitnessNumbers {
  readonly vdot: number;
  readonly paceSecPerMi: number;
  readonly confidence: number;
  readonly sourceMode: SourceMode;
}

export type CurrentFitnessContract =
  | {
      readonly outcome: 'clean';
      readonly assessment: CaveatAssessment;
      readonly provenance: CurrentFitnessProvenance;
      /** @internal — reachable only through `withCurrentFitness`. Prefixed so
       *  a call site reading it is visible in review and in a grep. */
      readonly _numbers: CurrentFitnessNumbers;
    }
  | {
      readonly outcome: 'qualified';
      readonly assessment: CaveatAssessment;
      readonly provenance: CurrentFitnessProvenance;
      readonly _numbers: CurrentFitnessNumbers;
    }
  | {
      readonly outcome: 'refused';
      /** Either the underlying resolver's refusal, or a disqualifying caveat
       *  tier. Kept as one union so a caller handles refusal once. */
      readonly reason: CurrentFitnessRefusalReason | 'DISQUALIFYING_CAVEATS';
      readonly detail: string;
      readonly assessment: CaveatAssessment;
      readonly provenance: CurrentFitnessProvenance;
    };

/**
 * Lift a `CurrentFitnessRead` (the `6874b4518` resolver's own output, taken
 * unchanged) into the caveat-forcing contract.
 *
 * The underlying resolver is NOT modified. That is deliberate: it is the
 * artifact under independent review at that SHA, and a proposal that edits
 * the thing it is reviewing makes the review unrepeatable. This composes over
 * it instead, and the composition is the proposed adoption shape.
 */
export function toCurrentFitnessContract(read: CurrentFitnessRead): CurrentFitnessContract {
  const reasons = read.provenance.canonicalBelief.reasons;
  const assessment = assessCaveats(reasons);

  if (!read.ok) {
    return {
      outcome: 'refused',
      reason: read.reason,
      detail: read.detail,
      assessment,
      provenance: read.provenance,
    };
  }
  if (assessment.tier === 'DISQUALIFYING') {
    return {
      outcome: 'refused',
      reason: 'DISQUALIFYING_CAVEATS',
      detail:
        `The canonical belief produced a number (${read.vdot.toFixed(1)}) and the evidence behind `
        + `it cannot support one. ${assessment.why}`,
      assessment,
      provenance: read.provenance,
    };
  }
  const numbers: CurrentFitnessNumbers = {
    vdot: read.vdot,
    paceSecPerMi: read.paceSecPerMi,
    confidence: read.confidence,
    sourceMode: read.sourceMode,
  };
  return assessment.tier === 'CLEAN'
    ? { outcome: 'clean', assessment, provenance: read.provenance, _numbers: numbers }
    : { outcome: 'qualified', assessment, provenance: read.provenance, _numbers: numbers };
}

/**
 * THE ONLY SANCTIONED ROUTE TO THE NUMBERS.
 *
 * `onQualified` takes the caveats as a required second parameter, so a caller
 * that wants a qualified number has to write a function that receives them.
 * `onRefused` takes the assessment for the same reason: a refusal a caller
 * cannot explain to the runner is Rule 21's `{"n": 1}` log with better types.
 *
 * There is no default and no optional handler. Every outcome is answered, or
 * the call does not compile — Constitution §32's "the brain fails honestly",
 * made structural.
 *
 * ── WHAT THIS CANNOT ENFORCE (Rule 22) ─────────────────────────────────────
 *
 * · A CALLER THAT READS `._numbers` DIRECTLY. TypeScript has no true private
 *   field on a plain object type. The underscore makes it greppable and
 *   review-visible, and `_wave2_no_mutation_scan.test.ts` scans for it across
 *   the repo with a ratcheted allowlist — but a determined caller can still
 *   do it, and calling that "impossible" would be the kind of unverified
 *   header claim Rule 19 was earned on.
 * · A HANDLER THAT ACCEPTS THE CAVEATS AND IGNORES THEM. The type forces the
 *   parameter to be received, never that it be used. This raises the floor
 *   from "did not know" to "chose not to act", which is the most a type can
 *   do; the rest is review.
 * · WHETHER THE CAVEAT CLASSIFICATION IS RIGHT. `assessCaveats` encodes a
 *   judgement about which codes are confidence facts and which are absences.
 *   A miscategorised code produces a confident, well-typed, wrong tier.
 */
export function withCurrentFitness<T>(
  contract: CurrentFitnessContract,
  handlers: {
    onClean: (numbers: CurrentFitnessNumbers, provenance: CurrentFitnessProvenance) => T;
    onQualified: (
      numbers: CurrentFitnessNumbers,
      caveats: readonly CapacityReasonCode[],
      provenance: CurrentFitnessProvenance,
    ) => T;
    onRefused: (
      reason: CurrentFitnessRefusalReason | 'DISQUALIFYING_CAVEATS',
      detail: string,
      assessment: CaveatAssessment,
    ) => T;
  },
): T {
  switch (contract.outcome) {
    case 'clean':
      return handlers.onClean(contract._numbers, contract.provenance);
    case 'qualified':
      return handlers.onQualified(
        contract._numbers,
        contract.assessment.caveats,
        contract.provenance,
      );
    case 'refused':
      return handlers.onRefused(contract.reason, contract.detail, contract.assessment);
  }
}
