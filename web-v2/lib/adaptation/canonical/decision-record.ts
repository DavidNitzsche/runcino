/**
 * lib/adaptation/canonical/decision-record.ts · THE TYPED, VERSIONED RECORD
 * EVERY EVALUATION EMITS, WHATEVER THE OUTCOME.
 *
 * The contract's requirement, and Rule 21's:
 *
 *     "A log that records that something happened but not what is not a log.
 *      Every adaptation writes what it did, in which direction, and on what
 *      evidence, otherwise the next person cannot tell an engine that never
 *      pushes from a runner who never earned it."
 *
 * That ambiguity is exactly what let the zero-upgrade engine survive:
 * `training_plans.adaptation_log` stored `{"n": 1, "ts": "..."}`, a counter and
 * a timestamp, so establishing the zero required querying `coach_intents`
 * sideways. This type is the answer to that. Every field below exists because
 * its absence made a real question unanswerable.
 *
 * ── A REFUSAL IS A SUCCESSFUL OUTPUT ───────────────────────────────────────
 *
 * `REFUSE` is one of four decisions, not an error, not a thrown exception, not
 * an empty return. It carries the same complete record as `PROGRESS`, including
 * the evidence it did have and what further evidence would change it. An engine
 * that returns nothing when it cannot decide is indistinguishable from an
 * engine that was never called, which is the failure Rule 21 measured.
 *
 * ── WHY `evidenceExcluded` IS MANDATORY AND NOT AN OPTIONAL FIELD ──────────
 *
 * Contract Q27: "Do not globally admit or reject an entire activity when
 * different parts remain useful." An engine that silently drops a treadmill
 * session from pace evidence and says nothing looks identical to one that never
 * saw it. The exclusion list is how a reader tells "I considered this and set
 * it aside, here is why" apart from "I never had it", which is Rule 11 applied
 * to the audit trail rather than to the inputs.
 */
import type {
  CanonicalLever,
  CapacityBelief,
  EvaluationBoundary,
  GoalRequirement,
  RaceCalendar,
} from './input';
import type { StimulusGrade } from './stimulus';
import { CANONICAL_ADAPTATION_CONTRACT_VERSION } from './contract-constants';

/* ══════════════════════════════════════════════════════════════════════════
 * THE FOUR DECISIONS
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * PROGRESS · evidence supports advancing this lever, within its bound.
 * HOLD     · the lever was evaluated and should stay where it is. Distinct
 *            from REFUSE: a HOLD means the engine COULD judge and judged not
 *            to move. The contract's own example is a lever that has met its
 *            criteria but whose change the plan does not currently need.
 * REGRESS  · evidence shows the prescribed level is not being absorbed.
 * REFUSE   · the engine could not judge. Insufficient, unreadable or
 *            contradictory evidence. Never a silent pass, never an error.
 */
export type CanonicalDecision = 'PROGRESS' | 'HOLD' | 'REGRESS' | 'REFUSE';

export const CANONICAL_DECISIONS: readonly CanonicalDecision[] = [
  'PROGRESS',
  'HOLD',
  'REGRESS',
  'REFUSE',
];

/** Decisions that do not move a number. Useful for gates that count movement. */
export const NON_MOVING_DECISIONS: ReadonlySet<CanonicalDecision> =
  new Set<CanonicalDecision>(['HOLD', 'REFUSE']);

/* ══════════════════════════════════════════════════════════════════════════
 * EVIDENCE, INCLUDED AND EXCLUDED
 * ═══════════════════════════════════════════════════════════════════════ */

export interface IncludedEvidence {
  readonly activityId: string;
  readonly dateISO: string;
  readonly what: string;
  readonly grade: StimulusGrade | null;
  /**
   * Q39 · never a raw decimal in the runner-facing experience. This is the
   * auditable detail, where the contract explicitly allows it to live.
   */
  readonly weight: number;
}

/** Why an observation was set aside for THIS lever, on this evaluation. */
export type ExclusionReason =
  | 'OUTSIDE_EVIDENCE_WINDOW'
  | 'NOT_REPRESENTATIVE_FOR_PACE'
  | 'TREADMILL_CANNOT_PRICE_ROAD_PACE'
  | 'TRUNCATED_PORTION_REQUIRED'
  | 'GRADE_DOES_NOT_COUNT'
  | 'WRONG_LEVER_FOR_THIS_SESSION'
  | 'DATA_UNREADABLE'
  | 'PRESCRIBED_RECOVERY_OR_TAPER'
  | 'SINGLE_EXCEPTIONAL_PERFORMANCE';

export interface ExcludedEvidence {
  readonly activityId: string;
  readonly dateISO: string;
  readonly reason: ExclusionReason;
  /** Plain language, because a reason code alone is not an explanation. */
  readonly detail: string;
  /**
   * Q27 · what this observation IS still good for, when it is good for
   * something. The contract forbids globally rejecting an activity, so an
   * exclusion from pace evidence records that volume still counted it.
   */
  readonly stillAdmissibleFor: readonly string[];
}

/** Evidence pointing the other way. Never dropped; it lowers confidence. */
export interface ContradictoryEvidence {
  readonly activityId: string;
  readonly dateISO: string;
  readonly detail: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * CONFIDENCE  ·  Q39
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Uncertainty expressed the way Q39 requires: a range, evidence counts, a
 * plain-language limitation, and what would make it stronger. The raw decimal
 * exists but is explicitly marked as belonging to the auditable detail only.
 */
export interface ConfidenceStatement {
  readonly supportingCount: number;
  readonly contradictingCount: number;
  readonly windowDays: number;
  /** The plain sentence a runner may read. */
  readonly sentence: string;
  /** The limitation, when there is one worth naming. */
  readonly limitation: string | null;
  /** Auditable detail only. Q39 forbids this leading the experience. */
  readonly rawConfidence: number;
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE PROPOSED CHANGE
 * ═══════════════════════════════════════════════════════════════════════ */

export type MagnitudeUnit = 'sec_per_mi' | 'weekly_mi' | 'long_run_mi';

export interface Magnitude {
  readonly unit: MagnitudeUnit;
  /** Signed. Negative is faster for pace, smaller for distance. */
  readonly value: number;
  /** The bound that applied, and where it came from. */
  readonly limit: number;
  readonly limitConstant: string;
  readonly limitCitation: string;
}

/**
 * One edited future workout. The contract requires the COMPLETE proposed plan
 * diff, not a summary, and requires every affected session to be recomposed and
 * validated rather than patched numerically in isolation. This type carries the
 * before and after of each edit so a reviewer can read the whole change.
 */
export interface PlanDiffEntry {
  readonly workoutId: string;
  readonly dateISO: string;
  readonly field: string;
  readonly before: string | number;
  readonly after: string | number;
}

export interface PlanDiff {
  readonly entries: readonly PlanDiffEntry[];
  /** Where the reach stops, and why that is the boundary. */
  readonly reachEndsISO: string | null;
  readonly reachRule: string;
  /**
   * Contract: "No proposal may rewrite sealed or completed history." Asserted
   * here as data so a gate can check it rather than trusting the composer.
   */
  readonly touchesCompletedHistory: false;
}

/** An invariant the proposed plan was checked against. */
export interface InvariantResult {
  readonly id: string;
  readonly passed: boolean;
  readonly detail: string;
}

/** How to undo the change, if it is ever applied. */
export interface RollbackInfo {
  readonly lever: CanonicalLever;
  readonly restoreTo: string | number;
  readonly restoreField: string;
  readonly affectedWorkoutIds: readonly string[];
  readonly note: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE RECORD
 * ═══════════════════════════════════════════════════════════════════════ */

export interface CanonicalDecisionRecord {
  /* identity and versioning */
  readonly contractVersion: typeof CANONICAL_ADAPTATION_CONTRACT_VERSION;
  readonly athleteId: string;
  readonly planVersion: string;
  readonly evidenceVersion: string;
  readonly evaluatedAtISO: string;
  readonly boundary: EvaluationBoundary;
  /**
   * `athlete · plan version · evidence version · lever · evaluation boundary`.
   * Re-ingesting the same evidence produces the same key, and a caller that
   * has seen the key already must not raise a second proposal.
   */
  readonly idempotencyKey: string;

  /* the question */
  readonly lever: CanonicalLever;
  readonly belief: CapacityBelief;
  readonly race: RaceCalendar;
  readonly goal: GoalRequirement;
  /** What the goal requires that the belief does not yet supply. */
  readonly gap: string;

  /* the evidence */
  readonly evidenceIncluded: readonly IncludedEvidence[];
  readonly evidenceExcluded: readonly ExcludedEvidence[];
  readonly contradictory: readonly ContradictoryEvidence[];
  readonly windowDays: number;
  readonly confidence: ConfidenceStatement;

  /* the change */
  readonly decision: CanonicalDecision;
  readonly beforeValue: number;
  /** Null for HOLD and REFUSE, which propose no new value. */
  readonly proposedAfterValue: number | null;
  readonly magnitude: Magnitude | null;
  readonly affectedWorkoutIds: readonly string[];
  readonly planDiff: PlanDiff;
  readonly invariants: readonly InvariantResult[];

  /* the explanation */
  readonly reason: string;
  /** Contract: what future evidence could change this decision. */
  readonly whatWouldChangeIt: readonly string[];
  readonly rollback: RollbackInfo | null;

  /**
   * Set when arbitration deferred an otherwise valid proposal. The contract
   * requires suppressed proposals and their reason to be recorded.
   */
  readonly suppressedBy: SuppressionNote | null;
}

/**
 * WHY a proposal was deferred, as a code rather than by matching on prose.
 *
 * Added 2026-09-04 with arbitration reading C. Before it, the only machine
 * readable field on a suppression was `by`, which names WHO and not WHICH RULE,
 * and two different rules both wrote `by: 'PLAN_LOAD'`. The deferral queue has
 * to tell them apart to know when a queued item is due for reconsideration, and
 * a queue that told them apart by regex over `detail` would be one coach-voice
 * edit away from silently mis-filing every deferral (Rule 16: one fact, one
 * name, and prose is not a name).
 */
export type DeferralRule =
  /** Rule 1 · the complete projected week is at the athlete's demand ceiling. */
  | 'WEEK_AT_DEMAND_CEILING'
  /** Rule 3 · another lever is already making a material change this cycle. */
  | 'ONE_MATERIAL_LEVER_PER_CYCLE'
  /** Cadence · evidence at a session boundary, arbitrated at the weekly one. */
  | 'ARBITRATED_AT_WEEKLY_BOUNDARY'
  /** Idempotency · this exact evidence has already raised this proposal. */
  | 'ALREADY_RAISED_ON_THIS_EVIDENCE';

export interface SuppressionNote {
  readonly by: CanonicalLever | 'PLAN_LOAD';
  /** Which arbitration rule deferred this, as a code. */
  readonly rule: DeferralRule;
  readonly detail: string;
  readonly reconsiderAtISO: string | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * IDEMPOTENCY
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The contract's key, verbatim: `athlete · plan version · evidence version ·
 * lever · evaluation boundary`.
 *
 * Note what is NOT in it: the timestamp. Including the wall clock would make
 * every re-evaluation unique and the key decorative, which is precisely the
 * failure it exists to prevent. Two evaluations of the same evidence at the
 * same boundary collide on purpose.
 */
export function idempotencyKeyFor(parts: {
  athleteId: string;
  planVersion: string;
  evidenceVersion: string;
  lever: CanonicalLever;
  boundary: EvaluationBoundary;
}): string {
  return [
    parts.athleteId,
    parts.planVersion,
    parts.evidenceVersion,
    parts.lever,
    parts.boundary,
  ].join(' · ');
}

/** The empty diff, for records that propose nothing. */
export const NO_PLAN_DIFF: PlanDiff = {
  entries: [],
  reachEndsISO: null,
  reachRule: 'No change proposed, so nothing is reached.',
  touchesCompletedHistory: false,
};
