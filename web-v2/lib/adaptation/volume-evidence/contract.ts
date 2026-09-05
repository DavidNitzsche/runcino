/**
 * lib/adaptation/volume-evidence/contract.ts · MILEAGE-RESPONSIVE-1.
 *
 * THE TYPES AND THE THRESHOLD LEDGER for the one question nothing in this app
 * owned: **if the runner runs MORE mileage than prescribed, does future planned
 * mileage increase?**
 *
 * ── THE MEASURED ANSWER BEFORE THIS DIRECTORY EXISTED · NO ────────────────
 *
 * Three independent paths read extra mileage, and all three point down or
 * nowhere. Verified against `a8392d08`, file and line:
 *
 *  1 · `lib/plan/adapt.ts` DETECTS it. `overshootFires` (line 1110) fires at
 *      `completedMi > overshootBaseline(...).baseline * 1.25`, and the only
 *      consequence the file can produce is its own header line 53: "Shave next
 *      7d by 17% (proportional)." It is in `PROPOSE_FIRST_TRIGGERS` (line
 *      1298), so it proposes rather than applies, but a CUT is the only thing
 *      it can propose.
 *  2 · The only upward volume lever, `tryAdaptiveBump` (`lib/plan/adaptive-
 *      ramp.ts:1013`), has `if (!automaticPlanMutationIsAuthorised()) return
 *      null;` as its first executable statement (line 1031).
 *      `AUTOMATIC_ADAPTATION_AUTHORITY: false = false`. Sealed by the owner on
 *      2026-09-02, and THIS DIRECTORY DOES NOT OPEN IT.
 *  3 · Even with that seam open, extra mileage reaches the ramp only through
 *      ACWR: `acwrHeadroom = acwrValue < ACWR_ADD_LOAD_CEILING` (1.3, line
 *      254). Running more raises acute load, raises ACWR, and CLOSES the gate.
 *      The five ramp signals are `acwrHeadroom`, `lastQualityOnPace`,
 *      `lastLongClean`, `belowTierUpper`, `noBumpRecent`. None of them reads
 *      "the runner ran more than prescribed".
 *
 * And one more, found while verifying the three above, which is the deeper
 * gap and the one this directory actually closes:
 *
 *  4 · `lib/plan/load-progression-contract.ts` is the ONE owner of "how much
 *      load", and its own header promises `demonstratedLoadAfterEachWeek`,
 *      "recomputed from completed weeks, which is what moves every number
 *      above". Nothing recomputed it. Measured on `a8392d08`,
 *      `resolveLoadProgressionContract` had exactly ONE caller in the whole
 *      app, `lib/plan/generate.ts:11633`, at AUTHORING. The envelope was struck
 *      once, off the evidence the runner had the day the block was written, and
 *      no completed week ever moved it. `respond.ts` in this directory is the
 *      SECOND caller and the only one that re-resolves it against evidence
 *      that arrived later; `_mileage_responsive.test.ts` asserts there is no
 *      third, because a third would be a second envelope and Rule 16 is the
 *      whole reason that module exists.
 *  5 · `lib/adaptation/canonical/levers/weekly-volume.ts` reads completion
 *      only through `meetsCompletionBar(frac, 0.95)` — a BOOLEAN. A week run
 *      at 95%, at 100% and at 140% of prescription are the same input to it,
 *      and its PROGRESS branch proposes a flat `nextWeekPrescribedMi × 0.05`
 *      in all three cases, for ONE week. Running 18% over prescription buys
 *      the runner nothing that running exactly to prescription does not.
 *
 * ── WHAT THIS DIRECTORY IS, AND IS NOT ────────────────────────────────────
 *
 * IS: a pure, shadow-only path from "valid extra mileage" to "the demonstrated-
 * volume belief moves, and future UNSEALED, ORDINARY weeks are larger",
 * expressed as a PROPOSAL and an EXPLANATION.
 *
 * IS NOT: a writer. Every file here is pure — no `pool`, no `fetch`, no clock.
 * `lib/adaptation/_zero_mutation_scan.test.ts` walks `lib/adaptation`
 * recursively and applies its guards to this directory for free; guard 1 bans
 * a write to any table but the shadow logs and guard 2 bans naming a plan
 * writer in code. Neither needed a new entry to cover this directory, and
 * `_mileage_responsive.test.ts` asserts that coverage rather than assuming it
 * (Rule 18 · a gate you have not watched reach your files is a hypothesis).
 *
 * IS NOT: a second answer to "how much load". `lib/plan/load-progression-
 * contract.ts` keeps that. This directory RE-RESOLVES that contract against
 * newer evidence; it does not re-derive the arithmetic (Rule 16, and
 * `docs/BRAIN_CONSTITUTION.md`'s one-question-one-owner table).
 *
 * IS NOT: a weakening of `volume_overshoot`. That guard is untouched, still
 * fires at 1.25x, and its 17% shave is still the response it proposes. Rule
 * 21: push by spending the headroom doctrine already allows. The overshoot
 * guard reads ABSORBED LOAD — Rule 8's corollary — and this directory reads
 * CAPABILITY. They are different questions and both answers stand.
 *
 * ── RULE 22 · WHAT EVERY GATE OVER THIS DIRECTORY CANNOT FAIL ON ──────────
 *
 * · It cannot fail on a prescription that was itself too small. Surplus is
 *   measured against what was prescribed, so a runner who exceeds an
 *   under-prescribed week reads identically to one who exceeds a correct week.
 *   Whether the baseline was right is the plan generator's question.
 * · It cannot fail on a mis-attributed run. A run recorded on the wrong day
 *   moves surplus between weeks and nothing here can tell that from the runner
 *   actually having run it then. `dataComplete` is trusted, not verified.
 * · It cannot fail on a WRONG CLASSIFICATION UPSTREAM. Every clause here reads
 *   `ExecutionMatch`, `StimulusGrade` and `DeteriorationVerdict` produced
 *   elsewhere. If the day resolver mis-tiers a run, this directory will spend
 *   the wrong classification confidently.
 * · It cannot fail on the SEAM. Nothing here is wired to a writer, so a test
 *   proving the proposal is correct proves nothing about the plan the runner
 *   sees. That is deliberate and the owner's ruling; it is also the single
 *   largest limitation of everything below.
 * · It cannot tell "no supplemental run happened" from "a supplemental run
 *   happened and was never synced". Both arrive as an absent row.
 */
import type { ExcludedEvidence, IncludedEvidence } from '@/lib/adaptation/canonical/decision-record';
import { absent, failed, measured, type Measured } from '@/lib/adaptation/canonical/input';
import { GRADES_THAT_COUNT_AS_EVIDENCE } from '@/lib/adaptation/canonical/stimulus';
import { reconsiderAtBoundary } from '@/lib/adaptation/canonical/deferral-queue';
import {
  CONTRACT_DOC,
  THRESHOLD_EVIDENCE_WINDOW_DAYS,
  THRESHOLD_EVIDENCE_WINDOW_DAYS_TIGHT,
  VOLUME_MAX_STEP_FRAC,
  VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE,
  VOLUME_MIN_CONSECUTIVE_WEEKS,
  VOLUME_WEEK_COMPLETION_MIN_FRAC,
} from '@/lib/adaptation/canonical/contract-constants';

/* ═══════════════════════════════════════════════════════════════════════════
 * ONE DOOR INTO THE CANONICAL ENGINE'S VOCABULARY
 *
 * `lib/adaptation/canonical/_cannot_mutate.test.ts` guard 4 forbids any file
 * outside that directory from importing a VALUE out of the engine except
 * through enumerated (file, module, symbols) grants, and it is right to: the
 * engine has almost no consumer inside the app at all, and that is the
 * property worth keeping. It caught this directory on the first full-suite
 * run, across five files.
 *
 * So this module takes ONE door rather than seven. Every other file here
 * imports these from `./contract`, which means the whole of this directory's
 * dependence on the engine is FOUR grants against ONE file, auditable in one
 * place, and a reviewer can see the entire surface without walking the tree.
 *
 * Nothing behind this door can DECIDE anything:
 *
 *   measured / absent / failed      pure constructors for `Measured<T>`
 *   GRADES_THAT_COUNT_AS_EVIDENCE   a frozen Set of two grade names
 *   VOLUME_* / THRESHOLD_EVIDENCE_* doctrine constants
 *   CONTRACT_DOC                    a citation string
 *   reconsiderAtBoundary            a PURE ledger function: it takes a queue
 *                                   and returns a queue, opens no connection
 *                                   and writes nothing
 *
 * There is deliberately NO re-export of `evaluateAdaptation`, of any lever, or
 * of `arbitrate`. This directory does not run the engine; it speaks the
 * engine's vocabulary so that a second dialect of "measured / absent / failed"
 * never has to exist (Rule 16).
 * ════════════════════════════════════════════════════════════════════════ */
export {
  absent, failed, measured,
  GRADES_THAT_COUNT_AS_EVIDENCE,
  reconsiderAtBoundary,
  CONTRACT_DOC,
  THRESHOLD_EVIDENCE_WINDOW_DAYS,
  THRESHOLD_EVIDENCE_WINDOW_DAYS_TIGHT,
  VOLUME_MAX_STEP_FRAC,
  VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE,
  VOLUME_MIN_CONSECUTIVE_WEEKS,
  VOLUME_WEEK_COMPLETION_MIN_FRAC,
};
export type { Measured };

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · WHAT THE EXTRA MILEAGE REPRESENTS
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The owner's own list, one member per item, plus the honest sixth state for
 * a week with nothing prescribed to be surplus TO.
 *
 * Rule 11 lives here rather than downstream: `RECORDING_ARTIFACT` and
 * `MOVED_SESSION` both produce a completed-mileage figure larger than the
 * prescription, and collapsing them into "he ran more" is exactly the error
 * that would train a runner on a duplicate row.
 */
export type SurplusKind =
  /** The prescribed session was run, and run LONGER than prescribed. */
  | 'PRESCRIBED_OVERRUN'
  /** A run on a day with no prescription, or beyond the day's prescription. */
  | 'SUPPLEMENTAL_RUN'
  /** The same prescribed work, executed on a different day. Not new volume. */
  | 'MOVED_SESSION'
  /** A duplicate, a merged row, or a distance nobody can read. Never evidence. */
  | 'RECORDING_ARTIFACT'
  /** A race or an unusual event. Real load, but not ordinary training volume. */
  | 'RACE_OR_EVENT'
  /** Nothing was prescribed for this day at all, and no plan covered it. */
  | 'UNPRESCRIBED_WEEK';

/**
 * The kinds whose miles may be spent as POSITIVE VOLUME EVIDENCE.
 *
 * `MOVED_SESSION` is excluded because the work is already counted in the
 * week's prescription; crediting it twice manufactures a surplus out of a
 * reschedule. `RECORDING_ARTIFACT` is excluded because it is not training.
 * `RACE_OR_EVENT` is excluded because a race is not a training week and
 * `Research/00b` gives it its own recovery protocol; Rule 8 is the same
 * argument one level up.
 */
export const KINDS_THAT_COUNT_AS_VOLUME_EVIDENCE: ReadonlySet<SurplusKind> =
  new Set<SurplusKind>(['PRESCRIBED_OVERRUN', 'SUPPLEMENTAL_RUN']);

export interface SurplusRun {
  readonly activityId: string;
  readonly dateISO: string;
  /** Rule 11 · an unreadable distance is not a zero-mile run. */
  readonly distanceMi: Measured<number>;
  /**
   * The day resolver's tier (`lib/execution/day-resolver.ts`). `null` means
   * the resolver could not be run for this day, which is a REFUSAL input, not
   * a supplemental run.
   */
  readonly match: 'exact' | 'legacy_type' | 'supplemental' | null;
  /** True when `runs.data` carries `mergedIntoId`. Rule 14's canonical predicate. */
  readonly mergedIntoAnother: boolean;
  readonly isRace: boolean;
  /** Miles prescribed by the workout this run satisfied. Null when supplemental. */
  readonly prescribedMi: number | null;
  /** Set when this run executed a prescription authored for another day. */
  readonly movedFromDateISO: string | null;
}

/** Rule 11 · a week is not merely "excluded", it is excluded FOR a reason. */
export type NonNormalReason =
  | 'AUTHORED_RECOVERY_BLOCK'
  | 'AUTHORED_TAPER'
  | 'CUTBACK_WEEK'
  | 'PLAN_MARKED_RACE_WEEK'
  | 'INSIDE_A_RACE_TAPER_OR_RECOVERY_WINDOW';

export interface ClassifiedRun {
  readonly activityId: string;
  readonly dateISO: string;
  readonly kind: SurplusKind;
  /** Miles this run contributes ABOVE what it was prescribed. Never negative. */
  readonly surplusMi: number;
  readonly countsAsVolumeEvidence: boolean;
  readonly detail: string;
}

export interface WeekSurplusInput {
  readonly weekStartISO: string;
  /** What the ACTIVE plan asked for across this week. */
  readonly prescribedMi: number;
  readonly runs: readonly SurplusRun[];
  /** The week's authoring intent. Rule 8's first filter. */
  readonly authoredPlanMode: 'BUILD' | 'RECOVERY' | 'TAPER' | 'UNKNOWN';
  readonly isCutback: boolean;
  readonly isRaceWeek: boolean;
  /**
   * Rule 8's OTHER filter, and it is a different fact from the three above.
   * True when any day of the week falls inside a taper lead-in or a post-race
   * recovery window for a race the runner actually ran
   * (`lib/training/normal-window.ts`'s `isPrescribedNonNormal`).
   *
   * Carried as its own field rather than folded into `isRaceWeek` because the
   * two are not the same claim and the runner-facing reason differs: a race
   * week is a week the PLAN marked, and this is a window the RACE CALENDAR
   * opens whether the plan noticed or not. Folding them was written first and
   * backed out: the report then said "race week" over weeks that were nothing
   * of the kind, which is Rule 16 at the level of a sentence.
   */
  readonly inPrescribedRaceWindow: boolean;
  /** False when the week holds missing, duplicate or misattributed activity data. */
  readonly dataComplete: boolean;
}

export interface WeekSurplus {
  readonly weekStartISO: string;
  readonly prescribedMi: number;
  /** Canonical, readable miles only. Refuses when any row is unreadable. */
  readonly completedMi: Measured<number>;
  /** completed - prescribed, floored at zero. Refuses when completed refuses. */
  readonly rawSurplusMi: Measured<number>;
  /** The part of the surplus whose KIND may be spent as volume evidence. */
  readonly admissibleSurplusMi: Measured<number>;
  /** True when this week is Rule 8 non-normal (recovery / taper / cutback / race). */
  readonly prescribedNonNormal: boolean;
  /** WHICH fact made it non-normal. Null when it is an ordinary week. */
  readonly nonNormalBecause: NonNormalReason | null;
  readonly runs: readonly ClassifiedRun[];
  readonly excluded: readonly ExcludedEvidence[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · WHETHER IT MAY BE ACCEPTED AS POSITIVE VOLUME EVIDENCE
 * ═══════════════════════════════════════════════════════════════════════ */

/** The owner's five conditions, one member each, in his order. */
export type AdmissionCondition =
  | 'EXECUTION_IDENTITY_TRUSTWORTHY'
  | 'TELEMETRY_USABLE'
  | 'NO_MATERIAL_DETERIORATION'
  | 'NO_PAIN_INJURY_OR_UNPLANNED_RECOVERY'
  | 'SUBSEQUENT_TRAINING_SHOWS_ABSORPTION';

export type ConditionVerdict = 'MET' | 'NOT_MET' | 'UNREADABLE';

export interface ConditionReading {
  readonly condition: AdmissionCondition;
  readonly verdict: ConditionVerdict;
  readonly detail: string;
}

/**
 * RULE 11, AS A TYPE. Three outcomes, and the two refusals are DIFFERENT
 * refusals with different downstream meaning:
 *
 *  · `NOT_SUPPORTED` — we looked, and the evidence says no. A real answer.
 *  · `UNREADABLE`    — we could not look. Never a licence to proceed, and
 *                      never the same fact as "the runner did not earn it".
 *
 * The admitted branch is the ONLY one carrying `mi`, so `admission.mi` does
 * not compile until the caller has narrowed. Copied deliberately from
 * `NormalReading<T>` in `lib/training/normal-window.ts` and `LoadReading` in
 * `lib/plan/load-progression-contract.ts`, which is the pattern this repo has
 * settled on for exactly this failure.
 */
export type SurplusAdmission =
  | {
    readonly admitted: true;
    readonly mi: number;
    readonly conditions: readonly ConditionReading[];
  }
  | {
    readonly admitted: false;
    readonly outcome: 'NOT_SUPPORTED' | 'UNREADABLE';
    readonly blocking: readonly AdmissionCondition[];
    readonly conditions: readonly ConditionReading[];
  };

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · THE BELIEF
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * WHICH SIDE OF RULE 8'S COROLLARY EACH READER FALLS ON, stated per field
 * because the rule requires it and because getting it wrong in either
 * direction is a defect:
 *
 *   over-filtering makes an injury guard MORE permissive;
 *   under-filtering trains the runner's next block off his own taper.
 */
export interface DemonstratedVolumeBelief {
  readonly asOfISO: string;
  /**
   * CAPABILITY · Rule 8 FILTERED. The biggest representative week. "What is
   * the most this runner has shown he can carry" is a habit-and-capability
   * question, and a week the engine itself prescribed as taper is not an
   * answer to it.
   */
  readonly peakWeeklyMi: number | null;
  /**
   * CAPABILITY · Rule 8 FILTERED. The rank-3 week: what he has reached
   * REPEATEDLY, which is the quantity `sustainedWeeklyMileage` already owns.
   */
  readonly sustainedWeeklyMi: number | null;
  /** CAPABILITY · Rule 8 FILTERED. What he is demonstrably carrying now. */
  readonly heldWeeklyMi: number | null;
  /** CAPABILITY · Rule 8 FILTERED. Representative trailing mean. */
  readonly meanWeeklyMi: number | null;
  /**
   * ABSORBED LOAD · Rule 8's COROLLARY, deliberately NOT FILTERED.
   *
   * "What the connective tissue will experience next week is a function of
   * what it actually did, not of what this runner normally does." A taper week
   * really did happen, and a guard that reads this number must keep reading
   * the literal recent figure. Nothing in this directory spends it as
   * capability; it exists so a downstream guard has the unfiltered number
   * under a name that says which question it answers (Rule 16).
   */
  readonly absorbedWeeklyMiUnfiltered: number | null;
  /** Every change this update made, and the evidence that made it. */
  readonly moves: readonly BeliefMove[];
}

export interface BeliefMove {
  readonly field: 'peakWeeklyMi' | 'sustainedWeeklyMi' | 'heldWeeklyMi' | 'meanWeeklyMi';
  readonly fromMi: number | null;
  readonly toMi: number;
  readonly because: string;
  readonly evidence: readonly IncludedEvidence[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * 9 · THE SAME RIGOUR DOWNWARD · one low week must not destroy the model
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * FIVE DISTINGUISHABLE FACTS, not one number. Rule 11, and the reason this
 * type exists at all: a zero measured inside a prescribed recovery block and a
 * zero measured off a detrained runner are OPPOSITE FACTS, and the engine has
 * already shipped four separate defects from collapsing them.
 *
 * Only `GENUINE_CAPACITY_LOSS` may move a belief down, and even then it may
 * never move `peakWeeklyMi`: a maximum the runner has actually run is a
 * permanent fact about him. See `RULE_21_THRESHOLD_LEDGER` row 7 for the
 * argument, which is the one deliberate asymmetry in this directory.
 */
export type LowWeekCause =
  | 'PRESCRIBED_RECOVERY_OR_TAPER'
  | 'MISSED_TRAINING'
  | 'TRAVEL_OR_LIFE'
  | 'ILLNESS_OR_INJURY'
  | 'INCOMPLETE_DATA'
  | 'GENUINE_CAPACITY_LOSS';

export interface LowWeekReading {
  readonly weekStartISO: string;
  readonly cause: LowWeekCause;
  readonly mayLowerBelief: boolean;
  readonly detail: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4-7 · THE RESPONSE
 * ═══════════════════════════════════════════════════════════════════════ */

/** Why a future week was left exactly as authored. */
export type PreservationReason =
  | 'IN_THE_PAST'
  | 'SEALED'
  | 'CUTBACK_WEEK'
  | 'TAPER_WEEK'
  | 'RACE_WEEK'
  | 'RECOVERY_BLOCK'
  | 'ALREADY_AT_OR_ABOVE_THE_ENVELOPE'
  | 'SIMULTANEOUS_VOLUME_AND_INTENSITY';

export interface FutureWeek {
  readonly weekStartISO: string;
  readonly prescribedMi: number;
  readonly sealed: boolean;
  readonly isCutback: boolean;
  readonly isTaper: boolean;
  readonly isRaceWeek: boolean;
  /** Named stressors, for `detectSimultaneousStressAddition`. */
  readonly stressors: readonly string[];
  readonly longestMi: number;
  readonly mpMi: number;
}

export interface FutureWeekChange {
  readonly weekStartISO: string;
  readonly beforeMi: number;
  readonly afterMi: number;
  readonly deltaMi: number;
  readonly preserved: PreservationReason | null;
  readonly why: string;
}

export const MILEAGE_RESPONSIVE_LEVER = 'WEEKLY_VOLUME' as const;

/* ══════════════════════════════════════════════════════════════════════════
 * RULE 21 · EVERY UPWARD THRESHOLD BESIDE ITS DOWNWARD OPPOSITE
 * ═══════════════════════════════════════════════════════════════════════ */

export interface ThresholdPair {
  readonly question: string;
  readonly up: string;
  readonly down: string;
  readonly symmetric: boolean;
  /** Required when `symmetric` is false. A citation, never a preference. */
  readonly asymmetryJustification: string | null;
}

/**
 * "Put its threshold beside its opposite number's and justify any asymmetry
 * with a citation. Five downgrades against zero upgrades is not a runner's
 * record, it is an engine's disposition."
 *
 * `_mileage_responsive.test.ts` asserts every row is real: each named constant
 * must resolve to the value quoted here, and every asymmetric row must carry a
 * justification. A row cannot be added without both halves.
 */
export const RULE_21_THRESHOLD_LEDGER: readonly ThresholdPair[] = [
  {
    question: 'How many representative weeks of evidence are required.',
    up: 'VOLUME_MIN_CONSECUTIVE_WEEKS = 3',
    down: 'VOLUME_MIN_CONSECUTIVE_WEEKS = 3',
    symmetric: true,
    asymmetryJustification: null,
  },
  {
    question: 'What counts as "he ran more" / "he ran less" than prescribed.',
    up: 'surplus > GPS_DISTANCE_ERROR_LO_FRAC (0.01) of prescribed, then credited '
      + 'CONTINUOUSLY and saturating at VOLUME_ADDITION_THRESHOLD (0.05)',
    down: 'shortfall > VOLUME_ADDITION_THRESHOLD (0.05) of prescribed',
    symmetric: false,
    asymmetryJustification:
      'CONTINUOUS-EVIDENCE-1, and it is asymmetric in the direction Rule 21 asks for: the bar '
      + 'to go UP is now LOWER than the bar to come down, and the rule forbids only the '
      + 'reverse. The owner found the old symmetry costing him a week he had actually run: '
      + '"47.3 against 45.5 prescribed but contributed zero evidence because it missed a 47.8 '
      + 'bar by 0.4 miles. That is another cliff." VOLUME_ADDITION_THRESHOLD did not change '
      + 'value or doctrine, it changed ROLE: it was the floor a week had to clear to be '
      + 'admitted at all and it is now the CEILING on what one week may contribute '
      + '(PER_WEEK_CREDIT_CEILING_FRAC), so total upward exposure per week is unchanged while '
      + 'the granularity below it went from binary to continuous. What remains as a hard NO '
      + 'is Research/15 §"Pace and GPS Accuracy"\'s 1-3% GPS distance error: below its lower '
      + 'edge a surplus is the receiver rather than the runner. The downward path is untouched '
      + 'and lives where it always did: volume_overshoot in lib/plan/adapt.ts and the REGRESS '
      + 'branch of lib/adaptation/canonical/levers/weekly-volume.ts.',
  },
  {
    question: 'The largest single step a proposal may make to one week.',
    up: 'VOLUME_MAX_STEP_FRAC (0.05) of the affected week, SCALED by '
      + 'progressionFraction (0 to 1)',
    down: 'VOLUME_MAX_STEP_FRAC = 0.05 of the affected week',
    symmetric: false,
    asymmetryJustification:
      'CONTINUOUS-EVIDENCE-1. The upward CEILING is identical; what differs is that the '
      + 'upward step is multiplied by how much evidence has actually accumulated, so it is '
      + 'never LARGER than the downward step and is usually smaller. A bar that only ever '
      + 'reduces the upward move cannot be the defect Rule 21 names. The owner\'s requirement '
      + 'is the reason: "Crossing a threshold cannot suddenly transform zero evidence into '
      + 'full evidence." Without this factor the accumulation bar would itself be a cliff, '
      + 'with the full doctrinal step on one side of it and nothing on the other.',
  },
  {
    question: 'How much evidence is needed for a FULL step, and how it accumulates.',
    up: 'PROGRESSION_UNLOCK_FRAC (0.15) accumulated units, which is Research/00a '
      + '§"Volume progression rules" upper edge (15% per training cycle); one week may '
      + 'contribute at most 0.05, so at least VOLUME_MIN_CONSECUTIVE_WEEKS (3) weeks are '
      + 'always required and a partial total buys a proportional step',
    down: 'One week never lowers a belief. VOLUME_MIN_CONSECUTIVE_WEEKS (3) consecutive '
      + 'representative low weeks with complete data and no declared cause are required '
      + 'for GENUINE_CAPACITY_LOSS, and even then peakWeeklyMi does not move.',
    symmetric: true,
    asymmetryJustification: null,
  },
  {
    question: 'What the week AFTER the surplus has to show.',
    up: 'Below ABSORPTION_FLOOR_FRAC (0.90, PROGRESSIVE_BASELINE_DOCTRINE.md Q9) '
      + 'contributes nothing; from there to ABSORPTION_CONFIRMED_FRAC (0.95, the '
      + 'contract\'s weekly-volume bar) it counts in proportion; unrun is PROVISIONAL '
      + 'at PROVISIONAL_ABSORPTION_WEIGHT (0.5), never zero.',
    down: 'A low following week does not lower any belief. Only classifyLowWeek\'s '
      + 'GENUINE_CAPACITY_LOSS moves a number down, and it needs three weeks.',
    symmetric: false,
    asymmetryJustification:
      'THE ONE PLACE THIS CHANGE IS MORE PERMISSIVE THAN WHAT IT REPLACED, said plainly '
      + 'rather than buried: a following week at 94% used to contribute zero and now '
      + 'contributes 80 per cent of the absorption factor. Three things bound it. (1) The '
      + 'contract\'s 0.95 has not moved; it is still where absorption reads as CONFIRMED and '
      + 'the ramp reaches 1 there exactly. (2) The categorical NO moved only as far as '
      + 'doctrine\'s OTHER stated weekly-completion bar, Q9\'s 90%, so nothing below a bar '
      + 'doctrine itself states is credited. (3) The per-week credit ceiling and '
      + 'VOLUME_MAX_STEP_FRAC are unchanged, so the total mileage this can add is exactly '
      + 'what it was; only the granularity between the two doctrine bars improved. The '
      + 'downward path reads absorbed load, not capability, and is untouched per Rule 8\'s '
      + 'corollary.',
  },
  {
    question: 'How often a step may be taken.',
    up: 'VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE = 1',
    down: 'VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE = 1',
    symmetric: true,
    asymmetryJustification: null,
  },
  {
    question: 'How a week the plan itself made non-normal is treated.',
    up: 'Excluded from the evidence window (Rule 8).',
    down: 'Excluded from the evidence window (Rule 8).',
    symmetric: true,
    asymmetryJustification: null,
  },
  {
    question: 'What an UNREADABLE week does.',
    up: 'Refuses. Missing data is never successful training.',
    down: 'Refuses. Missing data is never a missed week either.',
    symmetric: true,
    asymmetryJustification: null,
  },
  {
    question: 'Whether one contrary week may move the belief.',
    up: 'No. One big week never raises peakWeeklyMi on its own; the '
      + 'admission gate and the three-week window both have to pass.',
    down: 'No, and it may NEVER lower peakWeeklyMi at all. Only a '
      + 'GENUINE_CAPACITY_LOSS reading moves sustained/held/mean down.',
    symmetric: false,
    asymmetryJustification:
      'THE ONE DELIBERATE ASYMMETRY, and it favours the runner, which is the '
      + 'direction CLAUDE.md Rule 21 and Rule 22 say to check. A peak is a '
      + 'MAXIMUM: a week he has actually run is a permanent fact about him, and '
      + 'a later low week does not un-run it. Research/00a §"Volume progression '
      + 'rules" states base growth per training CYCLE, not per week, so a '
      + 'single week is the wrong window to revise a cycle-scale belief in '
      + 'either direction. The downward machinery this directory does not '
      + 'duplicate already exists and is untouched: lib/plan/adapt.ts '
      + 'volume_overshoot, and the REGRESS branch of '
      + 'lib/adaptation/canonical/levers/weekly-volume.ts.',
  },
  {
    question: 'What deterioration does.',
    up: 'DETERIORATED blocks admission. UNKNOWN also blocks admission.',
    down: 'DETERIORATED does not by itself lower the belief; it withholds a '
      + 'raise. UNKNOWN does nothing at all.',
    symmetric: false,
    asymmetryJustification:
      'Absence of evidence is not evidence of decline (Rule 11). Withholding a '
      + 'raise on an unreadable session costs the runner a week; cutting his '
      + 'plan on one costs him the block. lib/adaptation/canonical/'
      + 'deterioration.ts returns UNKNOWN rather than CLEAN for truncated or '
      + 'non-comparable thirds precisely so the caller can make this split.',
  },
];
