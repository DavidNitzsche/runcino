/**
 * lib/adaptation/canonical/input.ts · THE ONLY THINGS THIS ENGINE CAN SEE.
 *
 * The forbidden-input list in `docs/PLAN_SIMPLIFICATION_DOCTRINE.md` is not
 * enforced here by a runtime check that strips fields. It is enforced by the
 * input type having nowhere to put them.
 *
 *   readiness · sleep · HRV · resting HR · TSB · self-declared experience ·
 *   goal pace as proof of capacity · a single exceptional workout ·
 *   missing data read as successful training · injury or illness automation
 *
 * `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md` states the standard
 * this follows: goal data "physically excluded from capacity resolvers'
 * inputs, not just conventionally kept separate". The same treatment is given
 * to all ten.
 *
 * ── HOW EACH FORBIDDEN INPUT IS EXCLUDED, ONE BY ONE ────────────────────────
 *
 * · readiness, sleep, HRV, resting HR, TSB · no field of this type, at any
 *   depth, carries them. `_forbidden_inputs.test.ts` walks the type's own
 *   source and every source file in this directory and fails on the
 *   vocabulary, so adding one is a build failure and not a review question.
 *
 * · self-declared experience · same, and note that no field here is
 *   self-reported at all. Every input is an observation of something that
 *   happened or a prescription that was authored.
 *
 * · goal pace as proof of capacity · the goal IS present, in `goal`, because
 *   the decision record has to state the requirement and the gap. It is
 *   excluded STRUCTURALLY from the levers instead: every lever function in
 *   `levers/` takes evidence and constants and has no goal parameter, so a
 *   lever cannot read the goal even by accident. The gate asserts the
 *   signatures, which is the property that actually matters, because a lever
 *   that never receives the goal cannot be talked into pricing off it.
 *
 * · a single exceptional workout · excluded by the corroboration bars in
 *   `contract-constants.ts`, which every lever applies before it may propose.
 *   A one-off cannot reach `THRESHOLD_MIN_QUALIFYING_SESSIONS`.
 *
 * · missing data read as successful training · this is the reason
 *   `Readability` exists and is a required field. Rule 11: absent, unreliable
 *   and measured-zero are three facts. A week with no data is not a week at
 *   0% and it is not a week at 100%; it is a week the engine refuses to grade.
 *
 * · injury or illness automation · no field carries either, and this engine
 *   has no downward safety lever at all. Its `REGRESS` outcome exists for
 *   evidence that a prescribed level is not being absorbed, which is a
 *   training observation. Safety remains with its own owner, untouched.
 *
 * ── WHAT THIS TYPE DELIBERATELY DOES NOT DO ────────────────────────────────
 *
 * It carries no raw activity. Every physiological judgement arrives already
 * made, exactly as the older engine's header requires: this layer counts and
 * compares judgements, it never derives one from a split or a heart rate. That
 * is why `GradedSession` carries a `StimulusGrade` and per-third summaries
 * rather than a samples array.
 */
import type { StimulusGrade } from './stimulus';

/* ══════════════════════════════════════════════════════════════════════════
 * IDENTITY AND VERSIONING
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The evaluation boundary. Contract "Cadence and reach": evaluate after a
 * relevant completed quality session, long run or race; at the weekly boundary
 * once evidence has settled; after a materially corrected or late-arriving
 * activity. Never during a session.
 *
 * `SESSION_COMPLETED` updates evidence and asks whether a lever has new
 * information. `WEEKLY_BOUNDARY` is the one that arbitrates plan-level change.
 */
export type EvaluationBoundary =
  | 'SESSION_COMPLETED'
  | 'WEEKLY_BOUNDARY'
  | 'EVIDENCE_CORRECTED';

/** The three levers this contract defines. Nothing else may propose. */
export type CanonicalLever = 'THRESHOLD_PACE' | 'WEEKLY_VOLUME' | 'LONG_RUN';

export const CANONICAL_LEVERS: readonly CanonicalLever[] = [
  'THRESHOLD_PACE',
  'WEEKLY_VOLUME',
  'LONG_RUN',
];

/* ══════════════════════════════════════════════════════════════════════════
 * READABILITY  ·  Rule 11, as a required field rather than a convention
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Why a value is not present. Rule 11's three facts, typed so a caller cannot
 * collapse them: a value, an explicit absence, or an explicit failure.
 */
export type Readability =
  | { readonly kind: 'READ'; }
  | { readonly kind: 'ABSENT'; readonly what: string }
  | { readonly kind: 'FAILED'; readonly what: string };

/**
 * An observed quantity that may not have been observed.
 *
 * The refusal branch carries NO `value` field, so `m.value` does not compile
 * until the caller has branched. `lib/training/normal-window.ts` established
 * this pattern in this codebase and the reason given there applies unchanged:
 * it makes Rule 11 a type error rather than a discipline.
 */
export type Measured<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly why: Readability };

export const measured = <T>(value: T): Measured<T> => ({ ok: true, value });
export const absent = <T>(what: string): Measured<T> =>
  ({ ok: false, why: { kind: 'ABSENT', what } });
export const failed = <T>(what: string): Measured<T> =>
  ({ ok: false, why: { kind: 'FAILED', what } });

/* ══════════════════════════════════════════════════════════════════════════
 * EVIDENCE PROVENANCE  ·  contract "Evidence admissibility"
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Conditions that make an activity unrepresentative for a RAW PACE ANCHOR,
 * from the contract's own list. Representativeness is lever-specific: an
 * activity carrying any of these is still fully admissible for volume,
 * duration, completion and time on feet.
 */
export type PaceRepresentativenessFlag =
  | 'TREADMILL_UNCALIBRATED'
  | 'TRAIL'
  | 'HILLY_WITHOUT_TRUSTED_GRADE_ADJUSTMENT'
  | 'WIND_WITHOUT_TRUSTED_ADJUSTMENT'
  | 'ALTITUDE_MATERIALLY_DIFFERENT'
  | 'HEAT_WITHOUT_SUPPORTED_ADJUSTMENT'
  | 'DELIBERATELY_ALTERED_EFFORT'
  | 'WORK_PHASES_MISSING_OR_MISSEGMENTED'
  | 'INTERRUPTED_MATERIALLY';

/**
 * Truncation, contract Q29. Recorded distance and duration count; the missing
 * portion is never inferred and is NOT failed training.
 */
export interface Truncation {
  readonly truncated: boolean;
  /** Q29 · whether the captured work intervals finished before the cut. */
  readonly completeWorkPhasesCaptured: boolean;
  readonly note: string;
}

/** Where an observation came from, and what it may be spent on. */
export interface Provenance {
  readonly activityId: string;
  readonly dateISO: string;
  readonly paceFlags: readonly PaceRepresentativenessFlag[];
  readonly truncation: Truncation;
  /** Q28 · treadmill counts for load, never for road pace. */
  readonly treadmill: boolean;
}

/* ══════════════════════════════════════════════════════════════════════════
 * OBSERVATIONS
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The comparable-work thirds Q13 needs. Deliberately pre-segmented by the
 * evidence layer: Q13 is explicit that deterioration must not be inferred
 * "from whole-run thirds when the workout contains different prescribed
 * phases", so the segmentation decision belongs upstream of this engine.
 */
export interface ComparableThirds {
  readonly middlePaceSecPerMi: Measured<number>;
  readonly finalPaceSecPerMi: Measured<number>;
  readonly middleHrBpm: Measured<number>;
  readonly finalHrBpm: Measured<number>;
  /** Whether the thirds describe genuinely comparable prescribed work. */
  readonly comparable: boolean;
}

/**
 * One completed session, already graded and already classified by the evidence
 * layer. This engine reads the grade; it does not compute one from splits.
 */
export interface GradedSession {
  readonly provenance: Provenance;
  /** What the session tested. A session supports the lever it actually tests. */
  readonly tests: 'THRESHOLD' | 'HIGH_INTENSITY' | 'MARATHON_EFFORT' | 'EASY' | 'LONG_RUN';
  readonly grade: StimulusGrade;
  /** Work pace the session demonstrated, when it is admissible for pace. */
  readonly workPaceSecPerMi: Measured<number>;
  readonly thirds: ComparableThirds;
  /** Race distance when this session was a race, else null. */
  readonly raceDistance: 'FIVE_K' | 'TEN_K' | 'HALF' | 'MARATHON' | null;
}

/** One prescribed-versus-completed week. */
export interface WeekObservation {
  readonly weekStartISO: string;
  readonly prescribedMi: number;
  /** Rule 11 · a week nobody could read is not a week at zero. */
  readonly completedMi: Measured<number>;
  readonly isCutback: boolean;
  /** Whether every activity in the week was readable and correctly attributed. */
  readonly dataComplete: boolean;
}

/** One prescribed-versus-completed long run. */
export interface LongRunObservation {
  readonly provenance: Provenance;
  readonly prescribedMi: number;
  readonly completedMi: Measured<number>;
  readonly thirds: ComparableThirds;
  /**
   * Contract Q22 · "No material execution failure in the following key session
   * attributable to the long run." Absent when no key session has followed yet,
   * which is a refusal input, not a pass.
   */
  readonly followingKeySessionOk: Measured<boolean>;
}

/* ══════════════════════════════════════════════════════════════════════════
 * BELIEF, GOAL AND PLAN CONTEXT
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The current belief, CARRIED not computed. When a proposal names a pace it
 * names this number moved by a bounded step; this engine never resolves a
 * capacity of its own.
 */
export interface CapacityBelief {
  readonly thresholdPaceSecPerMi: number;
  readonly weeklyVolumeMi: number;
  readonly longRunMi: number;
  /**
   * How well established the belief is, as evidence counts rather than a score.
   * Q39 · raw decimals never lead the runner-facing experience, so the record
   * carries counts and a sentence, and this is what those are built from.
   */
  readonly supportingSessionCount: number;
  readonly oldestSupportingDateISO: string | null;
}

/**
 * The race CALENDAR · when and how far. Freely readable.
 *
 * `docs/PLAN_SIMPLIFICATION_DOCTRINE.md` lists "race date and distance" and
 * "the stated goal, kept distinct from current capacity" as two SEPARATE
 * permitted inputs, and this split is that distinction made structural. The
 * calendar is a fact about the season and the engine needs it to know how much
 * runway a change has. It says nothing about how fast the runner is.
 */
export interface RaceCalendar {
  readonly raceDateISO: string;
  readonly raceDistance: 'FIVE_K' | 'TEN_K' | 'HALF' | 'MARATHON';
}

/**
 * The GOAL · the stated aspiration, and nothing else.
 *
 * Split out from `RaceCalendar` because the first version of this type carried
 * both, and `_forbidden_inputs.test.ts` immediately caught a scheduling
 * helper reading `goal.raceDateISO` to compute remaining runway. That read was
 * harmless in itself and the type made it indistinguishable from a read of
 * goal PACE, which is not harmless at all.
 *
 * Now the harmless read cannot touch this type. Exactly one function in the
 * engine reads it, it returns a SENTENCE, and the gate asserts both.
 */
export interface GoalRequirement {
  /** The stated aspiration. Direction and requirement only, never capacity. */
  readonly goalFinishSeconds: number;
  readonly goalPaceSecPerMi: number;
}

/**
 * What the future plan looks like, for reach and arbitration. Read-only: this
 * engine projects against it and never edits it.
 */
export interface ProjectedPlanContext {
  readonly planVersion: string;
  /** The week a proposal would first affect. */
  readonly nextWeekStartISO: string;
  readonly nextWeekPrescribedMi: number;
  readonly nextWeekLongRunMi: number;
  readonly nextWeekQualityMinutes: number;
  /** Where the current reach stops. Contract "Reach is lever-specific". */
  readonly nextCutbackBoundaryISO: string | null;
  readonly nextRaceBoundaryISO: string | null;
  readonly taperStartISO: string | null;
  /** Future sessions a pace anchor would reprice, by id. */
  readonly futureThresholdSessionIds: readonly string[];
  /**
   * Upward steps already taken in the current cutback cycle, per lever. The
   * contract allows one per cycle for volume and long run.
   */
  readonly stepsTakenThisCycle: Readonly<Record<CanonicalLever, number>>;
  /** Anchor moves already made today. Contract: no same-day oscillation. */
  readonly anchorMovedTodayForLever: Readonly<Record<CanonicalLever, boolean>>;
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE INPUT
 * ═══════════════════════════════════════════════════════════════════════ */

export interface CanonicalAdaptationInput {
  readonly athleteId: string;
  readonly planVersion: string;
  /**
   * The evidence epoch. Part of the idempotency key: re-ingesting the same
   * evidence must produce the same key and therefore no duplicate proposal.
   */
  readonly evidenceVersion: string;
  readonly evaluatedAtISO: string;
  readonly boundary: EvaluationBoundary;

  readonly belief: CapacityBelief;
  readonly race: RaceCalendar;
  readonly goal: GoalRequirement;
  readonly plan: ProjectedPlanContext;

  readonly qualitySessions: readonly GradedSession[];
  readonly weeks: readonly WeekObservation[];
  readonly longRuns: readonly LongRunObservation[];

  /**
   * Rule 11 · false when a read FAILED rather than came back empty. A failed
   * read must never look like a runner with no evidence, and it must never look
   * like a runner who trained successfully.
   */
  readonly readable: boolean;
}
