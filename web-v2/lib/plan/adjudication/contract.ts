/**
 * lib/plan/adjudication/contract.ts · THE PLAN ADJUDICATION LAYER, as types.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * David, 2026-09-04, after an outside review found three sequence-level problems
 * this engine had passed:
 *
 *   "The brain clearly contains research and rules, but it is not yet reliably
 *    reasoning across them as a complete coaching system. It can quote the
 *    correct doctrine and evaluate individual workouts while still potentially
 *    assembling an incoherent overall sequence."
 *
 * He is right, and the cause is structural rather than a missing rule. EVERY
 * gate in this engine samples the output at POINTS and asks whether each point
 * is legal: `_maint_invariants` checks placement, `_dosing_sweep_gate` checks
 * per-session caps, the doctrine registry checks constants against their tables.
 * CLAUDE.md Rule 9's own audit said this about a different class — "every gate
 * samples the output space at POINTS ... Nothing sampled the derivative." This
 * is the same failure one level up: **nothing samples the SEQUENCE.**
 *
 * So a week can contain 6 mi at T, 9x3 min at I and a 21.5-mile long run, at
 * +26% over the runner's highest week ever and +19% over his longest run ever,
 * and pass every check in the repository — because each component is
 * individually legal and nothing asks what they cost together.
 *
 * ── THE OPTIMISATION TARGET, STATED ONCE ───────────────────────────────────
 *
 * **The maximum productive load this runner can ABSORB.** Not maximum safety,
 * not maximum difficulty, not mechanical compliance with a research table.
 *
 * That target has a direction: the default is to ADVANCE. A HOLD or a PULL_BACK
 * must be justified by evidence, in the same way a PUSH must. An adjudicator
 * that returns HOLD when it cannot decide has not been careful — it has picked
 * the option that never has to defend itself, which is exactly the disposition
 * CLAUDE.md Rule 21 measured at "309 coach_intents rows ... the number of UPWARD
 * adaptations is ZERO".
 *
 * ── THE DISTINCTION THE WHOLE LAYER TURNS ON ───────────────────────────────
 *
 * `ALLOWED` — a research table permits it. Says NOTHING about this runner.
 * `SUPPORTED` — he has completed something comparable, and it went well.
 * `CONDITIONAL` — it depends on evidence that does not exist yet.
 *
 * Conflating the first two is how the current preview arrived at a 10-mile
 * marathon-pace block for a runner whose demonstrated maximum is 4-5 miles, and
 * at a 21.5-mile long run for a runner whose longest is 18.0 — both cited to
 * doctrine, both correct as citations, neither earned.
 */

/** How well THIS runner's own history backs a prescription. */
export type EvidenceClass =
  /** He has completed something comparable and it went well. */
  | 'SUPPORTED'
  /** A research table permits it. Says nothing about him. */
  | 'ALLOWED'
  /** Depends on evidence that does not exist yet. */
  | 'CONDITIONAL'
  /** His own history argues against it. */
  | 'CONTRAINDICATED'
  /** Nothing comparable exists either way — an honest absence (Rule 11). */
  | 'UNKNOWN';

/** The three options every material decision must actually compare. */
export type Option = 'PUSH' | 'HOLD' | 'PULL_BACK';

/** Doctrine's own force. A guideline losing to a hard constraint is not a
 *  conflict; two hard constraints disagreeing is, and must be adjudicated. */
export type DoctrineForce = 'HARD_CONSTRAINT' | 'GUIDELINE' | 'HEURISTIC';

export interface DoctrineCitation {
  readonly source: string;
  readonly section: string;
  readonly says: string;
  readonly force: DoctrineForce;
}

/** A doctrine conflict, named and RESOLVED — never silently resolved by
 *  quoting whichever sentence supports the proposal already made. */
export interface DoctrineConflict {
  readonly between: readonly [DoctrineCitation, DoctrineCitation];
  readonly resolvedInFavourOf: 0 | 1;
  /** Why. "It is more specific", "it is a hard constraint", "it is about this
   *  window and the other is about the block" — never "it agrees with us". */
  readonly because: string;
}

/** One comparable session from THIS runner's completed history. */
export interface ComparableSession {
  readonly dateISO: string;
  readonly what: string;
  readonly distanceMi: number | null;
  readonly avgPaceSecPerMi: number | null;
  readonly avgHrBpm: number | null;
  /** Did the intended work actually happen. */
  readonly executed: boolean;
  /** What the following 7 days looked like — the recovery half of the evidence. */
  readonly next7DaysMi: number | null;
  readonly notes: string;
}

/** The athlete-specific case for or against one prescription. */
export interface AthleteEvidence {
  readonly evidenceClass: EvidenceClass;
  readonly comparables: readonly ComparableSession[];
  /** His demonstrated maximum of the quantity being prescribed. */
  readonly demonstratedMax: number | null;
  readonly prescribed: number | null;
  /** prescribed / demonstratedMax − 1, as a fraction. Null when either is absent. */
  readonly stepOverDemonstrated: number | null;
  readonly why: string;
}

/** Stacked stress inside one week, and what it costs together. */
export interface StackedStress {
  readonly weekStartISO: string;
  readonly stressors: readonly string[];
  readonly weeklyMi: number;
  readonly longestMi: number;
  /** Against HIS history, not a table. */
  readonly volumeOverDemonstratedMax: number | null;
  readonly longRunOverDemonstratedMax: number | null;
  /** True when volume, longest run and stressor count all peak together. */
  readonly simultaneousPeak: boolean;
  readonly why: string;
}

/** One of the three options, costed. */
export interface OptionAppraisal {
  readonly option: Option;
  readonly describe: string;
  readonly evidenceClass: EvidenceClass;
  /**
   * Expected adaptation, in the only honest currency available: the fraction of
   * the intended stimulus we expect him to ABSORB. `null` when it cannot be
   * estimated — never a made-up number (Rule 11).
   */
  readonly expectedAbsorbedFrac: number | null;
  readonly risk: string;
}

/** The whole reasoning for ONE material decision, kept so it can be read. */
export interface DecisionTrace {
  readonly decisionId: string;
  readonly dateISO: string;
  readonly what: string;
  readonly windowDays: 7 | 14 | 28;
  readonly athlete: AthleteEvidence;
  readonly stacked: StackedStress | null;
  readonly options: readonly OptionAppraisal[];
  readonly chosen: Option;
  /** Why the chosen option produces the highest expected adaptation. */
  readonly because: string;
  readonly rejected: readonly { readonly option: Option; readonly why: string }[];
  readonly conflicts: readonly DoctrineConflict[];
  readonly citations: readonly DoctrineCitation[];
  /** Set when this decision must be re-taken closer to the date, because the
   *  evidence it depends on does not exist yet. */
  readonly reassessOnISO: string | null;
}

/** The six dimensions that must all hold before a plan may reach production. */
export interface PromotionCheck {
  readonly athleteSpecificSupport: boolean;
  readonly wholeBlockCoherence: boolean;
  readonly recoverability: boolean;
  readonly progression: boolean;
  readonly taperIntegrity: boolean;
  readonly doctrineResolution: boolean;
}

export interface PlanAdjudication {
  readonly traces: readonly DecisionTrace[];
  readonly check: PromotionCheck;
  /** False when ANY dimension is missing. Promotion is blocked, by name. */
  readonly mayPromote: boolean;
  readonly blockedBecause: readonly string[];
}

/** Every dimension, so a caller cannot silently forget one. */
export const PROMOTION_DIMENSIONS = [
  'athleteSpecificSupport', 'wholeBlockCoherence', 'recoverability',
  'progression', 'taperIntegrity', 'doctrineResolution',
] as const satisfies readonly (keyof PromotionCheck)[];
