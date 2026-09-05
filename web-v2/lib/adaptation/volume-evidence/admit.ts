/**
 * lib/adaptation/volume-evidence/admit.ts · STEP 2 · MAY THIS SURPLUS BE
 * ACCEPTED AS POSITIVE VOLUME EVIDENCE, AND STEP 9 · THE SAME RIGOUR DOWNWARD.
 *
 * The owner's five conditions, one clause each, in his order:
 *
 *   1 · execution identity is trustworthy
 *   2 · telemetry is usable
 *   3 · the run did not materially deteriorate
 *   4 · it created no unresolved pain, injury or recovery evidence
 *   5 · subsequent training indicates the load was absorbed
 *
 * ── EVERY READER HERE ALREADY EXISTED · RULE 16 ───────────────────────────
 *
 * Nothing in this file grades a session, judges a heart-rate trace or decides
 * whether a long run fell apart. It ASKS, and the answers come from the
 * modules that own those questions:
 *
 *   identity      lib/execution/day-resolver.ts   (`ExecutionMatch` tiers)
 *   grade         lib/adaptation/canonical/stimulus.ts
 *                 (`gradeStimulus`, `GRADES_THAT_COUNT_AS_EVIDENCE`)
 *   telemetry     lib/adaptation/canonical/hr-trace-credibility.ts
 *                 (`hrTraceIsCredible`), work-hr-ceiling.ts
 *   deterioration lib/adaptation/canonical/deterioration.ts
 *                 (`assessDeterioration`, `deteriorationPattern`)
 *
 * This file is the SEQUENCE and the REFUSAL POLICY over them, which is the
 * part nobody owned.
 *
 * ── RULE 11, TWICE, AND IT IS THE WHOLE FILE ──────────────────────────────
 *
 * Upward: `UNREADABLE` is a distinct outcome from `NOT_SUPPORTED`. A telemetry
 * trace nobody could read is not a runner who failed to absorb the work, and
 * the two must not produce the same downstream sentence.
 *
 * Downward: `classifyLowWeek` returns SIX causes, of which exactly ONE may
 * lower a belief. This is Rule 8's corollary generalised, and it is the shape
 * that has produced more defects in this engine than any other: a zero
 * measured inside a prescribed recovery block and a zero measured off a
 * detrained runner are OPPOSITE FACTS.
 *
 * ── RULE 21 · THE BAR UP AGAINST THE BAR DOWN ─────────────────────────────
 *
 * `RULE_21_THRESHOLD_LEDGER` in `./contract.ts` is the full table and is
 * asserted row by row in `_mileage_responsive.test.ts`. The two asymmetries
 * are row 7 (a low week may never lower `peakWeeklyMi`) and row 8 (UNKNOWN
 * deterioration withholds a raise but never causes a cut). Both favour the
 * runner, which is the direction Rule 22 says to check for, and both carry a
 * citation rather than a preference.
 *
 * ── RULE 22 · WHAT THIS FILE'S GATE CANNOT FAIL ON ────────────────────────
 *
 * · It cannot fail on a WRONG GRADE or a WRONG DETERIORATION VERDICT. Every
 *   clause reads a verdict produced upstream and will spend a wrong one
 *   confidently. Whether the graders are right is their own files' question.
 * · It cannot fail on absorption evidence that has not happened yet. Condition
 *   5 reads the week AFTER the surplus week, so the newest evidence is always
 *   PROVISIONAL: it is admitted, recorded, and carries
 *   `PROVISIONAL_ABSORPTION_WEIGHT` rather than full credit until the
 *   following week is run. That delay is real and it is the correct posture,
 *   because absorption is a fact about the future of the load rather than
 *   about the run. Until CONTINUOUS-EVIDENCE-1 this branch was UNREADABLE and
 *   the newest week counted for nothing at all, which collapsed "has not
 *   happened yet" into "could not be read" (Rule 11).
 * · It cannot see pain the runner did not report. `painOrInjuryReported`
 *   arrives as `Measured<boolean>` and an absent report reads as ABSENT, never
 *   as "no pain".
 * · It cannot distinguish TRAVEL_OR_LIFE from MISSED_TRAINING without the
 *   runner or the calendar saying so. Both arrive as a low week with no
 *   prescribed reason, and the loader's `declaredCause` is what separates
 *   them. With nothing declared this file answers MISSED_TRAINING, which is
 *   the reading that withholds a raise rather than granting one.
 */
import type { DeteriorationPattern } from '@/lib/adaptation/canonical/deterioration';
import type { HrTraceVerdict } from '@/lib/adaptation/canonical/hr-trace-credibility';
import type { Readability } from '@/lib/adaptation/canonical/input';
import type { StimulusGrade } from '@/lib/adaptation/canonical/stimulus';
// CONTINUOUS-EVIDENCE-1 · the two gates that remain in this file, and both are
// placed exactly where the continuous curve behind them already returns zero.
// That placement is what lets a pipeline with hard gates in it still be
// continuous end to end, and it is asserted in `_continuity_walk.test.ts`
// rather than claimed here (Rule 20).
import { ABSORPTION_FLOOR_FRAC, GPS_DISTANCE_ERROR_LO_FRAC } from './weight';
import { roundTo } from '@/lib/format/run';
import {
  GRADES_THAT_COUNT_AS_EVIDENCE,
  type Measured,
  type AdmissionCondition,
  type ConditionReading,
  type LowWeekCause,
  type LowWeekReading,
  type SurplusAdmission,
  type WeekSurplus,
} from './contract';

/**
 * The identity tiers whose miles may be spent. `lib/execution/day-resolver.ts`
 * produces three: `exact` (the run carries the prescription's own id),
 * `legacy_type` (matched by type on a day carrying exactly one prescription of
 * that type, with source and workout-type corroboration), and `supplemental`
 * (claimed by no prescription).
 *
 * ALL THREE ARE TRUSTWORTHY FOR A VOLUME QUESTION, and that is worth saying
 * explicitly because it is not true for every question. A supplemental run's
 * identity is not in doubt — it is a canonical row on a known day with a known
 * distance — it simply satisfied nothing. What is NOT trustworthy is `null`,
 * which means the resolver could not run at all, and `classify.ts` has already
 * turned that into `RECORDING_ARTIFACT` before this file sees it.
 */
export const TRUSTWORTHY_IDENTITY_TIERS: ReadonlySet<string> =
  new Set(['exact', 'legacy_type', 'supplemental']);

export interface AdmissionInput {
  readonly week: WeekSurplus;
  /**
   * Condition 1. False when any run contributing surplus could not be resolved
   * to a tier. Rule 11: `null` is "the resolver did not run", not "no".
   */
  readonly identityResolved: Measured<boolean>;
  /** Condition 2. `null` when no trace existed to judge, which is ABSENT not bad. */
  readonly telemetry: Measured<HrTraceVerdict>;
  /** Condition 3. From `deteriorationPattern` over the week's own sessions. */
  readonly deterioration: Measured<DeteriorationPattern>;
  /**
   * Condition 3, second half. The grades of the key sessions INSIDE this week.
   * An empty array is a base week prescribing only easy running and is not a
   * failure; a window whose every session graded outside
   * `GRADES_THAT_COUNT_AS_EVIDENCE` establishes nothing and blocks.
   */
  readonly keySessionGrades: readonly StimulusGrade[];
  /** Condition 4. */
  readonly painOrInjuryReported: Measured<boolean>;
  /**
   * Condition 4, second half. True when the runner took recovery the plan did
   * not prescribe in the days after the surplus.
   */
  readonly unplannedRecoveryTaken: Measured<boolean>;
  /**
   * Condition 5. The week AFTER the surplus week: did the runner carry on. A
   * refusal here is the honest state for the most recent week and it is why
   * the newest evidence is always one week behind.
   */
  readonly followingWeekCompletionFrac: Measured<number>;
  /**
   * Condition 5's bar. Reused from the canonical contract rather than re-typed
   * so the two cannot diverge (`VOLUME_WEEK_COMPLETION_MIN_FRAC`).
   */
  readonly absorptionCompletionBar: number;
}

/**
 * The human half of a `Readability`. `READ` is unreachable on a refusal branch
 * by construction and says so rather than printing "undefined" if it ever is.
 */
const whyText = (r: Readability): string => (r.kind === 'READ' ? 'the value was read' : r.what);

const met = (condition: AdmissionCondition, detail: string): ConditionReading =>
  ({ condition, verdict: 'MET', detail });
const notMet = (condition: AdmissionCondition, detail: string): ConditionReading =>
  ({ condition, verdict: 'NOT_MET', detail });
const unreadable = (condition: AdmissionCondition, detail: string): ConditionReading =>
  ({ condition, verdict: 'UNREADABLE', detail });

/**
 * THE FIVE CONDITIONS, EVALUATED IN FULL EVERY TIME.
 *
 * No early return: every condition produces a reading on every call, whatever
 * the outcome. `lib/adaptation/canonical/evaluate.ts` argues this better than
 * this comment can — an engine that returns nothing when it cannot decide is
 * indistinguishable from an engine that was never called, and that ambiguity
 * is exactly how a zero-upgrade engine survived 309 production intents.
 */
export function admitSurplus(input: AdmissionInput): SurplusAdmission {
  const conditions: ConditionReading[] = [];
  const { week } = input;

  /* ── 0 · is there a surplus to admit at all ──────────────────────────── */

  if (!week.admissibleSurplusMi.ok) {
    const why = week.admissibleSurplusMi.why;
    const outcome = why.kind === 'FAILED' ? 'UNREADABLE' : 'NOT_SUPPORTED';
    return {
      admitted: false,
      outcome,
      blocking: [],
      conditions: [unreadable(
        'EXECUTION_IDENTITY_TRUSTWORTHY',
        `No admissible surplus could be measured for ${week.weekStartISO}: ${whyText(why)}`,
      )],
    };
  }

  /* ── 0b · IS THERE A SURPLUS AT ALL, OR IS IT THE WATCH ───────────────
   *
   * CONTINUOUS-EVIDENCE-1 · THIS IS WHERE THE CLIFF WAS.
   *
   * It used to compare `admissibleSurplusMi` against `prescribedMi ×
   * VOLUME_ADDITION_THRESHOLD` and return NOT_SUPPORTED below it and the FULL
   * surplus above it. The owner found what that does, on his own history:
   *
   *     "The closest historical week completed 47.3 against 45.5 prescribed
   *      but contributed zero evidence because it missed a 47.8 bar by 0.4
   *      miles. That is another cliff."
   *
   * Rule 9 exactly, with the signature that rule names: THE FITTER RUNNER GOT
   * NOTHING. So the magnitude question left this gate entirely. It is now
   * answered continuously, by `creditedSurplusFrac` in `./weight.ts`, and
   * `VOLUME_ADDITION_THRESHOLD` kept its value and its doctrine while changing
   * role — it was the FLOOR a week had to clear to be admitted, and it is now
   * the CEILING on how much credit one week may claim
   * (`PER_WEEK_CREDIT_CEILING_FRAC`).
   *
   * What remains here is the one question that is genuinely categorical: is
   * any of this the runner rather than the receiver. `Research/15`
   * §"Pace and GPS Accuracy" puts GPS distance error at 1-3%, and below the
   * lower edge a surplus is measurement noise. It is a MEASURED fact rather
   * than an unreadable one, so it is NOT_SUPPORTED and never UNREADABLE
   * (Rule 11).
   *
   * WHY THIS GATE IS NOT ITSELF A CLIFF, and the property the whole pipeline
   * rests on: the gate sits exactly where the curve behind it already equals
   * zero. `gpsNoiseGate(GPS_DISTANCE_ERROR_LO_FRAC)` is 0, and its derivative
   * there is 0 too, so a week a hair either side of this line delivers a hair
   * of evidence either way. `_continuity_walk.test.ts` walks across it and
   * asserts that rather than trusting this paragraph.
   */

  const noiseFloorMi = week.prescribedMi * GPS_DISTANCE_ERROR_LO_FRAC;
  if (week.admissibleSurplusMi.value <= noiseFloorMi) {
    return {
      admitted: false,
      outcome: 'NOT_SUPPORTED',
      blocking: [],
      conditions: [notMet(
        'EXECUTION_IDENTITY_TRUSTWORTHY',
        `${roundTo(week.admissibleSurplusMi.value)} mi of admissible surplus against `
        + `${roundTo(week.prescribedMi)} mi prescribed is inside the `
        + `${Math.round(GPS_DISTANCE_ERROR_LO_FRAC * 100)} per cent a GPS watch can misreport `
        + 'on its own, so it says nothing about the runner.',
      )],
    };
  }

  /* ── 1 · execution identity ──────────────────────────────────────────── */

  if (!input.identityResolved.ok) {
    conditions.push(unreadable(
      'EXECUTION_IDENTITY_TRUSTWORTHY',
      `The execution resolver could not be read: ${whyText(input.identityResolved.why)}`,
    ));
  } else if (!input.identityResolved.value) {
    conditions.push(notMet(
      'EXECUTION_IDENTITY_TRUSTWORTHY',
      'At least one run contributing the surplus could not be tied to a prescription or confirmed as its own session.',
    ));
  } else {
    conditions.push(met(
      'EXECUTION_IDENTITY_TRUSTWORTHY',
      'Every run contributing the surplus resolved to a known execution.',
    ));
  }

  /* ── 2 · telemetry ───────────────────────────────────────────────────── */

  if (!input.telemetry.ok) {
    // ABSENT is not the same as a bad trace. An easy week with no heart-rate
    // data is not a week that failed a telemetry test; it is a week with no
    // telemetry question to answer. Distance is what this lever spends, and
    // distance is readable (checked in step 0), so ABSENT passes and FAILED
    // does not. This is the split `work-hr-ceiling.ts` makes for the same
    // reason: `absent(...)` for a domain where the question does not apply.
    if (input.telemetry.why.kind === 'ABSENT') {
      conditions.push(met(
        'TELEMETRY_USABLE',
        'No heart-rate trace to judge, and distance is what this reading spends.',
      ));
    } else {
      conditions.push(unreadable(
        'TELEMETRY_USABLE',
        `The telemetry could not be read: ${whyText(input.telemetry.why)}`,
      ));
    }
  } else if (!input.telemetry.value.credible) {
    conditions.push(notMet(
      'TELEMETRY_USABLE',
      `The heart-rate trace is not usable: ${input.telemetry.value.why ?? 'no reason given'}`,
    ));
  } else {
    conditions.push(met('TELEMETRY_USABLE', 'The heart-rate trace is usable.'));
  }

  /* ── 3 · deterioration, and the grades of the week's own key sessions ── */

  const gradeBlockers = input.keySessionGrades.filter((g) => g === 'PARTIAL');
  const gradeSupport = input.keySessionGrades.filter((g) => GRADES_THAT_COUNT_AS_EVIDENCE.has(g));
  const establishedNothing = input.keySessionGrades.length > 0 && gradeSupport.length === 0;

  if (!input.deterioration.ok) {
    conditions.push(unreadable(
      'NO_MATERIAL_DETERIORATION',
      `Session execution could not be read: ${whyText(input.deterioration.why)}`,
    ));
  } else if (input.deterioration.value.repeated) {
    conditions.push(notMet(
      'NO_MATERIAL_DETERIORATION',
      `Sessions fell away late repeatedly: ${input.deterioration.value.detail}`,
    ));
  } else if (input.deterioration.value.deterioratedCount > 0) {
    conditions.push(notMet(
      'NO_MATERIAL_DETERIORATION',
      `A session in this week deteriorated: ${input.deterioration.value.detail}`,
    ));
  } else if (gradeBlockers.length > 0) {
    // Q38: PARTIAL is "not enough of the intended session to receive the full
    // training effect", which is a load-absorption fact and exactly what this
    // question asks about. DIFFERENT and INSUFFICIENT are NOT counted against
    // the runner here: `GRADES_THAT_COUNT_AS_EVIDENCE`'s own doc comment says
    // a different stimulus is "evidence about the lever it actually tested,
    // not about the one that was prescribed", and turning "not evidence FOR"
    // into "evidence AGAINST" is the Rule 11 collapse that cost the volume
    // lever every one of thirteen weekly boundaries.
    conditions.push(notMet(
      'NO_MATERIAL_DETERIORATION',
      `${gradeBlockers.length} key session(s) in this week graded PARTIAL.`,
    ));
  } else if (establishedNothing) {
    conditions.push(notMet(
      'NO_MATERIAL_DETERIORATION',
      'Key sessions ran in this week and none of them established the intended stimulus.',
    ));
  } else {
    conditions.push(met(
      'NO_MATERIAL_DETERIORATION',
      input.keySessionGrades.length === 0
        ? 'Nothing in the week fell away late, and no key session was prescribed.'
        : 'Nothing in the week fell away late, and the key sessions held.',
    ));
  }

  /* ── 4 · pain, injury, unplanned recovery ─────────────────────────────── */

  const painUnknown = !input.painOrInjuryReported.ok && input.painOrInjuryReported.why.kind === 'FAILED';
  const recoveryUnknown = !input.unplannedRecoveryTaken.ok && input.unplannedRecoveryTaken.why.kind === 'FAILED';
  const painYes = input.painOrInjuryReported.ok && input.painOrInjuryReported.value;
  const recoveryYes = input.unplannedRecoveryTaken.ok && input.unplannedRecoveryTaken.value;

  if (painUnknown || recoveryUnknown) {
    conditions.push(unreadable(
      'NO_PAIN_INJURY_OR_UNPLANNED_RECOVERY',
      'Whether the extra work left anything sore could not be read.',
    ));
  } else if (painYes) {
    conditions.push(notMet(
      'NO_PAIN_INJURY_OR_UNPLANNED_RECOVERY',
      'Pain or injury was reported after this week.',
    ));
  } else if (recoveryYes) {
    conditions.push(notMet(
      'NO_PAIN_INJURY_OR_UNPLANNED_RECOVERY',
      'Recovery the plan did not prescribe was taken after this week.',
    ));
  } else {
    conditions.push(met(
      'NO_PAIN_INJURY_OR_UNPLANNED_RECOVERY',
      'Nothing was reported sore and no unplanned recovery followed.',
    ));
  }

  /* ── 5 · absorption ──────────────────────────────────────────────────── */

  if (!input.followingWeekCompletionFrac.ok
    && input.followingWeekCompletionFrac.why.kind === 'ABSENT') {
    /* CONTINUOUS-EVIDENCE-1 · RULE 11, THREE WAYS, WHERE THERE WERE TWO.
     *
     * This branch used to be UNREADABLE, which meant the most recent week
     * could never be admitted on the day it ended. That collapsed two facts
     * the owner's specification keeps apart:
     *
     *   FAILED · we tried to read the following week and could not. A refusal.
     *   ABSENT · the following week HAS NOT HAPPENED. Not a refusal, and not a
     *            failure to absorb. It is the ordinary state of the newest
     *            evidence in any ledger.
     *
     * "Evidence remains PROVISIONAL until recovery indicates absorption" is a
     * sentence about the second, and provisional is not zero. So an unrun
     * following week is MET here and carries `PROVISIONAL_ABSORPTION_WEIGHT`
     * in `weighCapacity`, which is strictly between 0 and 1 by construction.
     * A week that was read and came in low is a different branch below and
     * confirms nothing.
     */
    conditions.push(met(
      'SUBSEQUENT_TRAINING_SHOWS_ABSORPTION',
      'The week after this one has not been run yet. The evidence is recorded and stays '
      + 'provisional until it is.',
    ));
  } else if (!input.followingWeekCompletionFrac.ok) {
    conditions.push(unreadable(
      'SUBSEQUENT_TRAINING_SHOWS_ABSORPTION',
      `The week after this one could not be read: ${whyText(input.followingWeekCompletionFrac.why)}`,
    ));
  } else {
    /* CONTINUOUS-EVIDENCE-1 · THE SECOND CLIFF, and it was the same shape.
     *
     * This clause used to BLOCK at `absorptionCompletionBar` (0.95), so a
     * following week at 94.9% erased the evidence and one at 95.1% spent all
     * of it. That is Rule 9 again, and it also mis-read the owner's own
     * specification, which is a sentence about CONFIRMATION and not about
     * existence:
     *
     *     "Evidence remains PROVISIONAL until recovery indicates absorption."
     *
     * Provisional is not zero. So absorption stopped being a gate on whether
     * the surplus happened and became the CONFIRMATION FACTOR on how much of
     * it may be spent, and there is exactly one answer to that question:
     * `absorptionWeight` in `./weight.ts`, called by `weighCapacity`. This
     * clause no longer has an opinion about the DEGREE, because two opinions
     * about one quantity is Rule 16.
     *
     * What it still does is READ, which is Rule 11's whole point: a following
     * week nobody could read is a refusal (handled above), and a following
     * week that came in at 56% is a MEASURED fact that the reading below
     * carries at weight zero. Both are honest, and they are different.
     *
     * The bar itself has not moved and is not weakened: `absorptionWeight`
     * still reaches 1 only at `VOLUME_WEEK_COMPLETION_MIN_FRAC` and is still
     * exactly 0 at or below `ABSORPTION_FLOOR_FRAC`, so a week the runner did
     * not carry on from buys nothing, as before. What changed is that it is
     * no longer ERASED — it is recorded as provisional evidence that a later
     * week's absorption can confirm.
     */
    const frac = input.followingWeekCompletionFrac.value;
    const pct = Math.round(frac * 100);
    conditions.push(met(
      'SUBSEQUENT_TRAINING_SHOWS_ABSORPTION',
      frac + 1e-9 < ABSORPTION_FLOOR_FRAC
        ? `The following week completed at ${pct}%, below the `
          + `${Math.round(ABSORPTION_FLOOR_FRAC * 100)}% at which a week counts as completed. `
          + 'The surplus is recorded and confirms nothing.'
        : frac + 1e-9 < input.absorptionCompletionBar
          ? `The following week completed at ${pct}%, between the `
            + `${Math.round(ABSORPTION_FLOOR_FRAC * 100)}% at which a week counts as completed `
            + `and the ${Math.round(input.absorptionCompletionBar * 100)}% at which absorption `
            + 'is confirmed. The evidence confirms in proportion.'
          : `The following week completed at ${pct}%.`,
    ));
  }

  /* ── the verdict ─────────────────────────────────────────────────────── */

  const failedConditions = conditions.filter((c) => c.verdict === 'NOT_MET');
  const unreadableConditions = conditions.filter((c) => c.verdict === 'UNREADABLE');

  // ORDER: a real NO beats a cannot-tell. If the evidence actively says the
  // work was not absorbed, that is the honest answer even when a second
  // condition was also unreadable.
  if (failedConditions.length > 0) {
    return {
      admitted: false,
      outcome: 'NOT_SUPPORTED',
      blocking: failedConditions.map((c) => c.condition),
      conditions,
    };
  }
  if (unreadableConditions.length > 0) {
    return {
      admitted: false,
      outcome: 'UNREADABLE',
      blocking: unreadableConditions.map((c) => c.condition),
      conditions,
    };
  }
  return { admitted: true, mi: roundTo(week.admissibleSurplusMi.value), conditions };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 9 · THE SAME RIGOUR DOWNWARD
 * ═══════════════════════════════════════════════════════════════════════ */

export interface LowWeekInput {
  readonly weekStartISO: string;
  readonly prescribedMi: number;
  readonly completedMi: Measured<number>;
  readonly prescribedNonNormal: boolean;
  /** False when the week holds missing, duplicate or misattributed data. */
  readonly dataComplete: boolean;
  /**
   * What the runner or the calendar SAID, when anything did. Rule 11: absent
   * is not "nothing happened", it is "nobody told us".
   */
  readonly declaredCause: Measured<'TRAVEL_OR_LIFE' | 'ILLNESS_OR_INJURY'>;
  /**
   * How many of the last `VOLUME_MIN_CONSECUTIVE_WEEKS` representative weeks
   * also came in below the bar. One week is never a loss of capacity.
   */
  readonly consecutiveLowRepresentativeWeeks: number;
  readonly minConsecutiveWeeksForLoss: number;
}

/**
 * SIX CAUSES, ONE OF WHICH MAY MOVE A BELIEF.
 *
 * The order is the argument, exactly as in `classifyRun`: the most explanatory
 * fact wins, because every later branch would spend the week as a shortfall.
 * `INCOMPLETE_DATA` sits above `MISSED_TRAINING` for the reason Rule 11 exists
 * — a week nobody could read is not a week the runner skipped — and
 * `PRESCRIBED_RECOVERY_OR_TAPER` sits above everything because Rule 8 says a
 * week the engine itself made small is not a fact about the runner at all.
 */
export function classifyLowWeek(input: LowWeekInput): LowWeekReading {
  const at = input.weekStartISO;

  if (input.prescribedNonNormal) {
    return {
      weekStartISO: at,
      cause: 'PRESCRIBED_RECOVERY_OR_TAPER',
      mayLowerBelief: false,
      detail: 'The plan authored this week small. It says nothing about what the runner can carry.',
    };
  }
  if (!input.completedMi.ok || !input.dataComplete) {
    return {
      weekStartISO: at,
      cause: 'INCOMPLETE_DATA',
      mayLowerBelief: false,
      detail: 'This week could not be read. Missing data is not a missed week.',
    };
  }
  if (input.declaredCause.ok && input.declaredCause.value === 'ILLNESS_OR_INJURY') {
    return {
      weekStartISO: at,
      cause: 'ILLNESS_OR_INJURY',
      mayLowerBelief: false,
      detail: 'Illness or injury explains the week. It is not evidence about training capacity.',
    };
  }
  if (input.declaredCause.ok && input.declaredCause.value === 'TRAVEL_OR_LIFE') {
    return {
      weekStartISO: at,
      cause: 'TRAVEL_OR_LIFE',
      mayLowerBelief: false,
      detail: 'Life got in the way of this week. It is not evidence about training capacity.',
    };
  }
  if (input.consecutiveLowRepresentativeWeeks >= input.minConsecutiveWeeksForLoss) {
    return {
      weekStartISO: at,
      cause: 'GENUINE_CAPACITY_LOSS',
      mayLowerBelief: true,
      detail: `${input.consecutiveLowRepresentativeWeeks} consecutive representative weeks below the bar, `
        + 'with no recovery block, no declared reason and complete data.',
    };
  }
  return {
    weekStartISO: at,
    cause: 'MISSED_TRAINING',
    mayLowerBelief: false,
    detail: 'A week short of the prescription. Stated, and not spent as a revision of what the runner can carry.',
  };
}
