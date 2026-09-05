/**
 * lib/plan/adjudication/contract.ts · THE PLAN ADJUDICATION LAYER, as types.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * David, 2026-09-04, after an outside review found sequence-level problems this
 * engine had passed:
 *
 *   "The brain clearly contains research and rules, but it is not yet reliably
 *    reasoning across them as a complete coaching system. It can quote the
 *    correct doctrine and evaluate individual workouts while still potentially
 *    assembling an incoherent overall sequence."
 *
 * EVERY other gate in this engine samples the output at POINTS and asks whether
 * each point is legal. Rule 9's own audit said it about a different class:
 * "every gate samples the output space at POINTS ... Nothing sampled the
 * derivative." This is that failure one level up. Nothing samples the SEQUENCE.
 *
 * ── THE OPTIMISATION TARGET, STATED ONCE ───────────────────────────────────
 *
 * **The maximum productive load this runner can ABSORB.** Not maximum safety,
 * not maximum difficulty, not mechanical compliance with a research table.
 *
 * The target has a direction: the default is to ADVANCE. A HOLD or a PULL_BACK
 * must be justified by evidence in the same way a PUSH must. An adjudicator
 * that returns HOLD when it cannot decide has not been careful, it has picked
 * the option that never has to defend itself, which is the disposition Rule 21
 * measured at "309 coach_intents rows ... the number of UPWARD adaptations is
 * ZERO".
 *
 * ── THE DISTINCTION THE WHOLE LAYER TURNS ON ───────────────────────────────
 *
 * `ALLOWED`      · a research table permits it. Says NOTHING about this runner.
 * `SUPPORTED`    · he has completed something comparable, and it went well.
 * `CONDITIONAL`  · it depends on evidence that does not exist YET.
 *
 * ── WHAT THE FIRST VERSION OF THIS FILE GOT WRONG ──────────────────────────
 *
 * David rejected the first CIM trace this layer produced, on seven counts. Four
 * of them were defects in these types, and the fixes are load-bearing:
 *
 * 1 · **Evidence is time-relative** (`asOfISO`, `demonstratedMaxProjected`).
 *     "Do not treat my current historical ceiling as a permanent future
 *     ceiling. October and November workouts must be evaluated against the
 *     training accumulated by then." A November prescription judged against a
 *     September body is judged against the wrong runner.
 *
 * 2 · **A ceiling claim needs more than one comparable** (`ceilingClaim`).
 *     "That is one comparison, not a demonstrated capacity limit." The first
 *     trace took the MINIMUM of a three-element set and called it his limit. He
 *     had in fact run 21.51 miles seven days after a half marathon, which was
 *     the maximum of that same set.
 *
 * 3 · **Provenance is part of every number** (`Provenance`, `Attributed<T>`).
 *     "The output must clearly distinguish calculated physiology, athlete
 *     evidence and policy assumptions." A weight somebody chose must never be
 *     printed in the same voice as a measurement.
 *
 * 4 · **A heuristic is named a heuristic** (`heuristicRankScore`). The field
 *     was called `expectedAbsorbedFrac` and described as expected adaptation
 *     while being a fixed lookup table. Rule 16: one quantity, one name, and
 *     the name must be true.
 *
 * The fifth fix is not in this file: weekly demand is now computed by
 * `weekly-demand.ts` from volume, intensity, long-run load, stacking, recent
 * adaptation, recovery and injury context, rather than by asking whether
 * mileage exceeds a plan-derived ceiling.
 */

// ── PROVENANCE · defect 4 ──────────────────────────────────────────────────

/**
 * Where a number came from. Printing all three in one voice is how a lookup
 * table gets read as physiology, which is the specific complaint that produced
 * this type.
 */
export type Provenance =
  /** Derived from a physiological model or a research table, and traceable. */
  | 'CALCULATED_PHYSIOLOGY'
  /** Measured from THIS runner's completed training. */
  | 'ATHLETE_EVIDENCE'
  /** Somebody chose it. Defensible, but not measured and not research. */
  | 'POLICY_ASSUMPTION';

/** Any number this layer reports, carrying where it came from. */
export interface Attributed<T> {
  readonly value: T;
  readonly provenance: Provenance;
  /** The citation, the measurement, or the argument. Never empty. */
  readonly basis: string;
}

// ── EVIDENCE ───────────────────────────────────────────────────────────────

/** How well THIS runner's own history backs a prescription. */
export type EvidenceClass =
  /** He has completed something comparable and it went well. */
  | 'SUPPORTED'
  /** A research table permits it. Says nothing about him. */
  | 'ALLOWED'
  /** Depends on evidence that does not exist yet. Carries an earning gate. */
  | 'CONDITIONAL'
  /** His own history argues against it, on enough comparables to say so. */
  | 'CONTRAINDICATED'
  /** Nothing comparable exists either way, an honest absence (Rule 11). */
  | 'UNKNOWN';

/** The three options every material decision must actually compare. */
export type Option = 'PUSH' | 'HOLD' | 'PULL_BACK';

/** Doctrine's own force. A guideline losing to a hard constraint is not a
 *  conflict, two hard constraints disagreeing is. */
export type DoctrineForce = 'HARD_CONSTRAINT' | 'GUIDELINE' | 'HEURISTIC';

export interface DoctrineCitation {
  readonly source: string;
  readonly section: string;
  readonly says: string;
  readonly force: DoctrineForce;
}

/** A doctrine conflict, named and RESOLVED, never silently settled by quoting
 *  whichever sentence supports the proposal already made. */
export interface DoctrineConflict {
  readonly between: readonly [DoctrineCitation, DoctrineCitation];
  readonly resolvedInFavourOf: 0 | 1;
  readonly because: string;
}

/** One comparable session from THIS runner's completed history. */
export interface ComparableSession {
  readonly dateISO: string;
  readonly what: string;
  readonly distanceMi: number | null;
  readonly avgPaceSecPerMi: number | null;
  readonly avgHrBpm: number | null;
  readonly executed: boolean;
  /** What the following 7 days looked like, the recovery half of the evidence. */
  readonly next7DaysMi: number | null;
  readonly notes: string;
}

/**
 * A claim that this runner's history establishes an upper limit.
 *
 * Defect 2 of David's list. A single comparable is an observation. A ceiling is
 * a much stronger claim and needs the set, and it must be read off the MAXIMUM
 * of that set rather than whichever member happens to be smallest.
 */
export interface CeilingClaim {
  /** The claimed limit, which must equal the max of the comparables. */
  readonly value: number;
  readonly comparableCount: number;
  /** False when too few comparables exist to claim a limit at all. */
  readonly valid: boolean;
  readonly why: string;
}

/**
 * How many comparable sessions before this layer may assert a capacity CEILING.
 *
 * POLICY_ASSUMPTION, and labelled as one. There is no research number for "how
 * many observations make a limit"; what there is, is a demonstrated failure at
 * n = 1, in the trace David rejected. Two observations can still be two bad
 * days, so three is the bar for refusing on the runner's own history. Nothing
 * stops a SINGLE comparable from SUPPORTING a prescription, because supporting
 * only requires that he has done it.
 */
export const MIN_COMPARABLES_FOR_CEILING_CLAIM = 3;

/** The athlete-specific case for or against one prescription, AT A DATE. */
export interface AthleteEvidence {
  readonly evidenceClass: EvidenceClass;
  readonly comparables: readonly ComparableSession[];

  /**
   * The date the prescription actually lands. Defect 1 of David's list: an
   * October workout is not performed by the runner who exists today.
   */
  readonly asOfISO: string;

  /** His demonstrated maximum of this quantity, from completed training only. */
  readonly demonstratedMaxToday: Attributed<number | null>;
  /**
   * What he would have demonstrated by `asOfISO` if the plan up to that date is
   * executed. Null when the intervening plan does not build toward it, which is
   * itself a finding: a prescription nothing prepares him for.
   */
  readonly demonstratedMaxProjected: Attributed<number | null>;

  readonly prescribed: number | null;
  /** Against `demonstratedMaxToday`. */
  readonly stepOverDemonstratedToday: number | null;
  /** Against `demonstratedMaxProjected`, the honest one for a future date. */
  readonly stepOverProjected: number | null;

  /** Present only when this evidence is used to REFUSE something. */
  readonly ceilingClaim: CeilingClaim | null;

  readonly why: string;
}

/**
 * Stacked stress inside one week: WHICH stressors coincide.
 *
 * Rule 16 boundary, because this and `WeeklyDemandSummary` are close enough to
 * be confused. This type is DESCRIPTIVE and answers "what lands in the same
 * seven days". `weekly-demand.ts` is QUANTITATIVE and answers "what does this
 * week cost", with stacking as one of its seven components. A trace reports
 * both because a runner needs to be told what coincides, not only that a number
 * is high.
 */
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

// ── EARNING GATES · defect 6 ───────────────────────────────────────────────

/** One measurable thing that must happen before a CONDITIONAL becomes SUPPORTED. */
export interface EarningRequirement {
  /** In the runner's language. "A 55 mile week, completed." */
  readonly what: string;
  /** In the engine's. The exact quantity and the grade that counts. */
  readonly measurable: string;
  readonly byISO: string;
}

/**
 * How a CONDITIONAL prescription can become SUPPORTED, or fail to.
 *
 * David: "A 60-mile week or 10-mile MP dose should be allowed to become
 * supported through successful September and October training rather than being
 * permanently accepted or rejected today."
 *
 * So the layer neither waves it through nor deletes it. It states what would
 * earn it, when that is checked, and what happens if it is not met.
 */
export interface EarningGate {
  readonly gateId: string;
  readonly forDecisionId: string;
  readonly requires: readonly EarningRequirement[];
  /** When the gate is evaluated. Must be before the prescription lands. */
  readonly assessOnISO: string;
  /** What happens when the requirements are NOT met by `assessOnISO`. */
  readonly ifUnmet: 'DEFER' | 'REDUCE' | 'DROP';
  /** The reduced value when `ifUnmet` is REDUCE. Null otherwise. */
  readonly reduceTo: number | null;
  /** What the runner would have to have done. Stated so he can aim at it. */
  readonly explain: string;
}

// ── OPTIONS ────────────────────────────────────────────────────────────────

/** One of the three options, costed. */
export interface OptionAppraisal {
  readonly option: Option;
  readonly describe: string;
  readonly evidenceClass: EvidenceClass;
  /**
   * A RANKING SCORE, not a prediction. Defect 4: this field was previously
   * called `expectedAbsorbedFrac` and described as the fraction of the stimulus
   * he is expected to absorb, while being a fixed lookup on `evidenceClass`. It
   * has never been calibrated against an outcome. It orders options; it does
   * not forecast anything, and it carries POLICY_ASSUMPTION provenance so no
   * reader can mistake it for physiology.
   *
   * Null when the class is UNKNOWN, because ranking an unknown is a made-up
   * number and Rule 11 forbids one.
   */
  readonly heuristicRankScore: Attributed<number> | null;
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
  /** Computed by `weekly-demand.ts`, not by comparing mileage to a ceiling. */
  readonly demand: WeeklyDemandSummary | null;
  readonly options: readonly OptionAppraisal[];
  readonly chosen: Option;
  readonly because: string;
  readonly rejected: readonly { readonly option: Option; readonly why: string }[];
  readonly conflicts: readonly DoctrineConflict[];
  readonly citations: readonly DoctrineCitation[];
  /** Set when the decision must be re-taken closer to the date. */
  readonly reassessOnISO: string | null;
  /** Set when the prescription is CONDITIONAL and can be earned. */
  readonly earningGate: EarningGate | null;
}

/**
 * What this layer needs from the demand model. The full shape lives in
 * `weekly-demand.ts`; this is the part a decision trace reports, kept narrow so
 * the two modules do not grow a second definition of the same quantity
 * (Rule 16).
 */
export interface WeeklyDemandSummary {
  readonly weekStartISO: string;
  readonly demandIndex: number | null;
  readonly athleteCeiling: number | null;
  readonly atCeiling: boolean | null;
  readonly unknownComponents: readonly string[];
  readonly explain: string;
}

/**
 * The dimensions that must all hold before a plan may reach production.
 *
 * ── WHY THERE ARE TEN AND NOT SIX (CORPUS-ADJ-1, 2026-09-04) ───────────────
 *
 * The owner's standard for this gate: "No literal true, nonempty-array proxy
 * or structurally impossible failure", and the final gate must be able to
 * evaluate athlete-specific support, whole-block coherence, recoverability,
 * progression, taper integrity, doctrine resolution, STACKED STRESS,
 * TIME-RELATIVE EARNING GATES, VALID EXECUTION IDENTITY and EVIDENCE
 * PROVENANCE.
 *
 * The last four were not dimensions. Three of them were not checked at all,
 * and stacked stress was folded into `recoverability` alongside the
 * one-stressor-at-a-time walk — so neither of those two could be failed on
 * its own, and a test that made one false could not tell which. Rule 16: one
 * quantity, one name.
 */
export interface PromotionCheck {
  readonly athleteSpecificSupport: boolean;
  readonly wholeBlockCoherence: boolean;
  /** The one-stressor-at-a-time walk across the SEQUENCE. */
  readonly recoverability: boolean;
  readonly progression: boolean;
  readonly taperIntegrity: boolean;
  readonly doctrineResolution: boolean;
  /**
   * Volume, longest run and stressor count peaking in ONE week. Split out of
   * `recoverability` so the two can fail independently — they are different
   * facts with different citations, and one name for two quantities is a
   * Rule 16 violation.
   */
  readonly stackedStress: boolean;
  /**
   * An earning gate must be assessable. It is checked BEFORE the prescription
   * it guards lands, and it may not ask whether a week that has not yet run
   * has been completed. A gate assessed on or after the day it guards cannot
   * change anything, which makes it decoration.
   */
  readonly earningGateTiming: boolean;
  /**
   * A race is not a training long run, and a training long run is not a race.
   * The goal race's 26.2 miles must never be read as a reach over the longest
   * training run — that is the same quantity carrying two identities, and it
   * would either flag the whole race week as a spike or, worse, count the race
   * as demonstrated training capacity.
   */
  readonly executionIdentity: boolean;
  /**
   * Every `Attributed` number on every trace says where it came from, in the
   * right voice, with a real basis. Defect 4 of David's list: "a weight
   * somebody chose must never be printed in the same voice as a measurement."
   */
  readonly evidenceProvenance: boolean;
}

export interface PlanAdjudication {
  readonly traces: readonly DecisionTrace[];
  readonly check: PromotionCheck;
  /** False when ANY dimension is missing. Promotion is blocked, by name. */
  readonly mayPromote: boolean;
  readonly blockedBecause: readonly string[];
  /** Every gate this plan is carrying, so nothing conditional is forgotten. */
  readonly earningGates: readonly EarningGate[];
}

/** Every dimension, so a caller cannot silently forget one. */
export const PROMOTION_DIMENSIONS = [
  'athleteSpecificSupport', 'wholeBlockCoherence', 'recoverability',
  'progression', 'taperIntegrity', 'doctrineResolution',
  'stackedStress', 'earningGateTiming', 'executionIdentity', 'evidenceProvenance',
] as const satisfies readonly (keyof PromotionCheck)[];
