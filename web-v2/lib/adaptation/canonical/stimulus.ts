/**
 * lib/adaptation/canonical/stimulus.ts · DID THE SESSION ACHIEVE ITS INTENDED
 * STIMULUS? Five outcomes, seven conditions, one noisy channel allowed.
 *
 * `docs/PROGRESSIVE_BASELINE_DOCTRINE.md` Q12, and the runner-facing meaning of
 * each grade in `docs/ADAPTATION_ENGINE_CONTRACT.md` Q38.
 *
 * ── THE REJECTED DESIGN, NAMED SO IT CANNOT COME BACK ───────────────────────
 *
 *     "The simple pace-OR-HR rule is rejected. Either channel can be
 *      misleading, and averages can hide failed repetitions."   — Q12
 *
 * So this file never asks "was pace in range OR was HR in range". It evaluates
 * seven conditions, decides which CHANNELS are credible, and requires the
 * surviving evidence to be credible on its own. Q12's two failure sentences are
 * the tests this was written against, and each has a named guard below:
 *
 *   · "do not let 'HR in range' validate a substantially underperformed
 *     session"  → `hrCannotRescueMissingWork`
 *   · "do not let 'pace in range' validate a session completed at clearly
 *     excessive effort"  → `paceCannotRescueExcessiveEffort`
 *
 * ── WHY A GRADE IS NOT A VERDICT ON THE RUNNER ─────────────────────────────
 *
 * Q38 is explicit and this file's reason strings follow it: PARTIAL states what
 * was completed and what was missing WITHOUT SCOLDING, DIFFERENT is not
 * failure, and INSUFFICIENT is never translated into a bad workout. A grade
 * describes what the training did, not how the runner behaved.
 *
 * ── RULE 22 · WHAT THIS FILE'S GATE CANNOT FAIL ON ─────────────────────────
 *
 * It cannot fail on a wrong upstream segmentation. Every input here is already
 * segmented by the evidence layer, and a session whose "work phase" was
 * mis-detected will be graded confidently against the wrong denominator. Q13's
 * own warning covers the same hazard for thirds. Condition 7 is the only
 * defence and it is a flag this file trusts rather than verifies.
 *
 * It also cannot fail on a well-formed but dishonest grade: nothing here proves
 * the grade matches what a coach would have said, only that it follows the
 * seven conditions. The replay ledger is the other half of that check.
 */
import {
  STIMULUS_MIN_WORK_DURATION_FRAC,
  STIMULUS_MIN_ACCEPTABLE_SEGMENT_FRAC,
  STIMULUS_WORK_PACE_TOLERANCE_FRAC,
  STIMULUS_RECOVERY_INFLATION_MAX_FRAC,
  STIMULUS_PARTIAL_MIN_WORK_FRAC,
} from './contract-constants';
import type { Measured, PaceRepresentativenessFlag } from './input';

/* ══════════════════════════════════════════════════════════════════════════
 * THE FIVE OUTCOMES
 * ═══════════════════════════════════════════════════════════════════════ */

export type StimulusGrade =
  | 'FULL'
  | 'SUBSTANTIAL'
  | 'PARTIAL'
  | 'DIFFERENT'
  | 'INSUFFICIENT';

/**
 * Which grades may count as evidence that a lever should move.
 *
 * Q12 · "For the earned-peak criterion, FULL and defensible SUBSTANTIAL count.
 * PARTIAL does not automatically count." The contract's weekly-volume lever
 * repeats it: "Key sessions FULL or defensible SUBSTANTIAL."
 *
 * DIFFERENT is excluded for the reason Q38 gives: a different stimulus may
 * still be useful, but it is evidence about the lever it actually tested, not
 * about the one that was prescribed.
 */
export const GRADES_THAT_COUNT_AS_EVIDENCE: ReadonlySet<StimulusGrade> =
  new Set<StimulusGrade>(['FULL', 'SUBSTANTIAL']);

/* ══════════════════════════════════════════════════════════════════════════
 * THE SEVEN CONDITIONS
 * ═══════════════════════════════════════════════════════════════════════ */

export type ConditionId =
  | 'C1_WORK_DURATION'
  | 'C2_SEGMENTS_ACCEPTABLE'
  | 'C3_WORK_PACE'
  | 'C4_HR_COMPATIBLE'
  | 'C5_NO_LATE_COLLAPSE'
  | 'C6_RECOVERIES_INTACT'
  | 'C7_DATA_COMPLETE';

/**
 * A condition is met, not met, unreadable, or deliberately discounted as the
 * one allowed noisy channel. Four states, not a boolean, for Rule 11's reason:
 * a condition nobody could evaluate and a condition that failed are opposite
 * facts, and collapsing them is how a missing heart-rate strap turns into a
 * failed workout.
 */
export type ConditionVerdict = 'MET' | 'NOT_MET' | 'UNREADABLE' | 'DISCOUNTED';

export interface ConditionResult {
  readonly id: ConditionId;
  readonly verdict: ConditionVerdict;
  readonly detail: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * INPUT
 * ═══════════════════════════════════════════════════════════════════════ */

export interface StimulusInput {
  /** C1 · prescribed and completed WORK time, excluding warm-up and cool-down. */
  readonly prescribedWorkSeconds: number;
  readonly completedWorkSeconds: Measured<number>;

  /** C2 · how many prescribed work segments were individually acceptable. */
  readonly prescribedSegments: number;
  readonly acceptableSegments: Measured<number>;

  /** C3 · the target work pace, or the slow edge of the prescribed range. */
  readonly targetWorkPaceSecPerMi: number;
  readonly actualWorkPaceSecPerMi: Measured<number>;

  /** C4 · mean work HR against the canonical ceiling for this session. */
  readonly meanWorkHrBpm: Measured<number>;
  readonly hrCeilingBpm: Measured<number>;
  /**
   * C4 · mean HR of EACH work segment, in prescribed order.
   *
   * Q12's own reason for having seven conditions rather than a pace-OR-HR rule
   * is that "averages can hide failed repetitions", and C4 was itself an
   * average. The real replay found the case: the owner's 2026-09-01 threshold
   * set ran 158, 161, 164 and 166 bpm against a 164 ceiling. The
   * duration-weighted mean is 162.2, so C4 read MET and the breach on the last
   * rep was invisible to the grade — and FULL is the grade that unlocks the
   * larger 5 s/mi anchor step.
   *
   * Rule 11 · an empty array is "no segment HR was recorded", which is not the
   * same as "no segment breached". C4 falls back to the mean alone in that
   * case and says so in its detail line rather than claiming a clean set.
   */
  readonly workSegmentHrBpm: readonly Measured<number>[];
  /** Whether the HR trace is trustworthy at all. Q12's HR discount reasons. */
  readonly hrReliable: boolean;

  /** C5 · a major late-session collapse, as judged by the evidence layer. */
  readonly majorLateCollapse: Measured<boolean>;

  /** C6 · recovery inflation. */
  readonly prescribedRecoverySeconds: number;
  readonly actualRecoverySeconds: Measured<number>;

  /** C7 · complete and correctly segmented. */
  readonly dataCompleteAndSegmented: boolean;

  /**
   * Conditions that make PACE unrepresentative. Q12 allows pace to be
   * discounted for hills, GPS error, heat, wind, or a deliberately
   * effort-governed workout.
   */
  readonly paceDiscountFlags: readonly PaceRepresentativenessFlag[];
}

export interface StimulusAssessment {
  readonly grade: StimulusGrade;
  readonly conditions: readonly ConditionResult[];
  /** Which channel, if either, was discounted as the one allowed noisy one. */
  readonly discountedChannel: 'PACE' | 'HR' | null;
  /** Q38's sentence for this grade, in coach voice. */
  readonly reason: string;
  /** Named so a report can quote why a grade was not stronger. */
  readonly limiting: readonly ConditionId[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE GRADER
 * ═══════════════════════════════════════════════════════════════════════ */

const pct = (n: number): string => `${Math.round(n * 100)}%`;

/**
 * Q38's sentences. Kept as one map so the runner-facing wording has exactly one
 * home (Rule 16) and the voice gate has one place to check (Rule 20).
 *
 * No em dash, no exclamation mark, no hype, no scolding. `docs/` house
 * punctuation is the middot.
 */
export const GRADE_SENTENCE: Readonly<Record<StimulusGrade, string>> = {
  FULL: 'You completed the workout and achieved its intended training effect.',
  SUBSTANTIAL:
    'The workout still did its job, with an adjustment or small execution difference.',
  PARTIAL:
    'You completed useful work, but not enough of the intended session to receive the full training effect.',
  DIFFERENT: 'This became a different workout from the one prescribed.',
  INSUFFICIENT: 'There is not enough reliable information to judge the workout.',
};

export function gradeStimulus(input: StimulusInput): StimulusAssessment {
  const conditions: ConditionResult[] = [];
  const add = (id: ConditionId, verdict: ConditionVerdict, detail: string) =>
    conditions.push({ id, verdict, detail });

  /* ── C7 first · nothing else can be trusted without it ─────────────────── */
  add(
    'C7_DATA_COMPLETE',
    input.dataCompleteAndSegmented ? 'MET' : 'NOT_MET',
    input.dataCompleteAndSegmented
      ? 'Activity data complete and correctly segmented.'
      : 'Activity data incomplete or incorrectly segmented.',
  );

  /* ── C1 · work duration ────────────────────────────────────────────────── */
  const workFrac = input.completedWorkSeconds.ok && input.prescribedWorkSeconds > 0
    ? input.completedWorkSeconds.value / input.prescribedWorkSeconds
    : null;
  if (workFrac === null) {
    add('C1_WORK_DURATION', 'UNREADABLE', 'Completed work duration could not be read.');
  } else {
    add(
      'C1_WORK_DURATION',
      workFrac >= STIMULUS_MIN_WORK_DURATION_FRAC ? 'MET' : 'NOT_MET',
      `Completed ${pct(workFrac)} of prescribed work duration.`,
    );
  }

  /* ── C2 · segments individually acceptable ─────────────────────────────── */
  const segFrac = input.acceptableSegments.ok && input.prescribedSegments > 0
    ? input.acceptableSegments.value / input.prescribedSegments
    : null;
  if (segFrac === null) {
    add('C2_SEGMENTS_ACCEPTABLE', 'UNREADABLE', 'Per-segment outcomes could not be read.');
  } else {
    add(
      'C2_SEGMENTS_ACCEPTABLE',
      segFrac >= STIMULUS_MIN_ACCEPTABLE_SEGMENT_FRAC ? 'MET' : 'NOT_MET',
      `${input.acceptableSegments.ok ? input.acceptableSegments.value : 0} of ${input.prescribedSegments} work segments acceptable.`,
    );
  }

  /* ── C3 · work pace, and the one allowed pace discount ─────────────────── */
  const paceDiscounted = input.paceDiscountFlags.length > 0;
  let paceCredible = false;
  let paceWithinTolerance = false;
  if (paceDiscounted) {
    add(
      'C3_WORK_PACE',
      'DISCOUNTED',
      `Pace discounted · ${input.paceDiscountFlags.join(', ')}.`,
    );
  } else if (!input.actualWorkPaceSecPerMi.ok) {
    add('C3_WORK_PACE', 'UNREADABLE', 'Work pace could not be read.');
  } else {
    paceCredible = true;
    const delta =
      (input.actualWorkPaceSecPerMi.value - input.targetWorkPaceSecPerMi)
      / input.targetWorkPaceSecPerMi;
    paceWithinTolerance = Math.abs(delta) <= STIMULUS_WORK_PACE_TOLERANCE_FRAC;
    add(
      'C3_WORK_PACE',
      paceWithinTolerance ? 'MET' : 'NOT_MET',
      `Work pace ${delta >= 0 ? 'slower' : 'faster'} than target by ${pct(Math.abs(delta))}.`,
    );
  }

  /* ── C4 · HR compatible, and the one allowed HR discount ───────────────── */
  const hrReadable = input.hrReliable && input.meanWorkHrBpm.ok && input.hrCeilingBpm.ok;
  let hrCredible = false;
  let hrAboveCeiling = false;
  /** Set when the mean cleared the ceiling but an individual repetition did not. */
  let hrSegmentBreach = false;
  if (!input.hrReliable) {
    add('C4_HR_COMPATIBLE', 'DISCOUNTED', 'Heart rate not reliable for this session.');
  } else if (!hrReadable) {
    add('C4_HR_COMPATIBLE', 'UNREADABLE', 'Heart rate or its ceiling could not be read.');
  } else {
    hrCredible = true;
    const ceiling = input.hrCeilingBpm.value;

    // The per-repetition half of C4. The bar is Q12.2's own ≥75%
    // individually-acceptable fraction, which is the only per-segment tolerance
    // the doctrine states; it is applied to the channel Q12's preamble says the
    // average was hiding. That reuse is deliberate and it is the arguable part
    // of this condition, so it is written down rather than resolved silently:
    // Q12.4 asks for HR "compatible with threshold work and not materially
    // contradicting the pace result" and does not put a number on it.
    const readableSegments = input.workSegmentHrBpm.filter((m) => m.ok);
    const overCeiling = readableSegments.filter(
      (m) => m.ok && m.value > ceiling,
    ).length;
    const compliantFrac = readableSegments.length === 0
      ? null
      : (readableSegments.length - overCeiling) / readableSegments.length;

    const meanOverCeiling = input.meanWorkHrBpm.value > ceiling;
    const tooManySegmentsOver =
      compliantFrac !== null && compliantFrac < STIMULUS_MIN_ACCEPTABLE_SEGMENT_FRAC;

    hrAboveCeiling = meanOverCeiling || tooManySegmentsOver;
    hrSegmentBreach = !hrAboveCeiling && overCeiling > 0;

    const segmentDetail = readableSegments.length === 0
      ? ' No per-segment heart rate was recorded, so only the average could be read.'
      : ` ${overCeiling} of ${readableSegments.length} work segments ran above the ceiling.`;

    add(
      'C4_HR_COMPATIBLE',
      hrAboveCeiling ? 'NOT_MET' : 'MET',
      `Mean work HR ${input.meanWorkHrBpm.value} against ceiling ${ceiling}.${segmentDetail}`,
    );
  }

  /* ── C5 · late collapse ────────────────────────────────────────────────── */
  if (!input.majorLateCollapse.ok) {
    add('C5_NO_LATE_COLLAPSE', 'UNREADABLE', 'Late-session behaviour could not be read.');
  } else {
    add(
      'C5_NO_LATE_COLLAPSE',
      input.majorLateCollapse.value ? 'NOT_MET' : 'MET',
      input.majorLateCollapse.value
        ? 'The session fell away materially in its final phase.'
        : 'No major late-session collapse.',
    );
  }

  /* ── C6 · recoveries ───────────────────────────────────────────────────── */
  const recFrac = input.actualRecoverySeconds.ok && input.prescribedRecoverySeconds > 0
    ? input.actualRecoverySeconds.value / input.prescribedRecoverySeconds
    : null;
  if (input.prescribedRecoverySeconds === 0) {
    add('C6_RECOVERIES_INTACT', 'MET', 'Session prescribed no recoveries.');
  } else if (recFrac === null) {
    add('C6_RECOVERIES_INTACT', 'UNREADABLE', 'Recovery duration could not be read.');
  } else {
    add(
      'C6_RECOVERIES_INTACT',
      recFrac <= 1 + STIMULUS_RECOVERY_INFLATION_MAX_FRAC ? 'MET' : 'NOT_MET',
      `Recovery ran to ${pct(recFrac)} of prescribed.`,
    );
  }

  const verdictOf = (id: ConditionId): ConditionVerdict =>
    conditions.find((c) => c.id === id)!.verdict;

  const limiting = conditions
    .filter((c) => c.verdict === 'NOT_MET' || c.verdict === 'UNREADABLE')
    .map((c) => c.id);

  const finish = (
    grade: StimulusGrade,
    discountedChannel: 'PACE' | 'HR' | null,
  ): StimulusAssessment => ({
    grade,
    conditions,
    discountedChannel,
    reason: GRADE_SENTENCE[grade],
    limiting,
  });

  const discountedChannel: 'PACE' | 'HR' | null = paceDiscounted
    ? 'PACE'
    : !input.hrReliable
      ? 'HR'
      : null;

  /* ── INSUFFICIENT · data, or both channels gone ────────────────────────── */

  // C7 governs everything. Q12.7 is a precondition, not one vote of seven.
  if (verdictOf('C7_DATA_COMPLETE') === 'NOT_MET') return finish('INSUFFICIENT', discountedChannel);

  // ONE noisy channel is allowed. Two is not evidence, it is an absence of it.
  if (!paceCredible && !hrCredible) return finish('INSUFFICIENT', discountedChannel);

  // The work denominator itself must be readable, or there is nothing to grade.
  if (verdictOf('C1_WORK_DURATION') === 'UNREADABLE'
    || verdictOf('C2_SEGMENTS_ACCEPTABLE') === 'UNREADABLE') {
    return finish('INSUFFICIENT', discountedChannel);
  }

  const workSatisfied =
    verdictOf('C1_WORK_DURATION') === 'MET' && verdictOf('C2_SEGMENTS_ACCEPTABLE') === 'MET';

  /* ── DIFFERENT · the workout changed in kind ───────────────────────────── */

  // Q12's second failure sentence, as a named guard: pace in range must not
  // validate a session completed at clearly excessive effort.
  const paceCannotRescueExcessiveEffort =
    hrCredible && hrAboveCeiling && paceCredible && paceWithinTolerance;
  if (paceCannotRescueExcessiveEffort) return finish('DIFFERENT', discountedChannel);

  // Recoveries stretched far enough that the session tested something else.
  if (verdictOf('C6_RECOVERIES_INTACT') === 'NOT_MET') return finish('DIFFERENT', discountedChannel);

  /* ── PARTIAL · a meaningful portion missed ─────────────────────────────── */

  // Q12's first failure sentence, as a named guard: HR in range must not
  // validate a substantially underperformed session. Checked BEFORE the
  // HR-supported SUBSTANTIAL path below, which is the path it exists to block.
  const hrCannotRescueMissingWork = !workSatisfied;
  if (hrCannotRescueMissingWork) return finish('PARTIAL', discountedChannel);

  /* ── FULL · both channels credible, and both agree ─────────────────────── */

  const noLateCollapse = verdictOf('C5_NO_LATE_COLLAPSE') === 'MET';

  // FULL requires BOTH channels, not one plus an excuse.
  //
  // The first draft allowed a discounted channel through here, and the suite
  // caught it: a session with a dead HR strap, on-target pace and complete work
  // graded FULL. Defensible on its face, and wrong where it matters, because
  // FULL is not merely a nicer word than SUBSTANTIAL. It is the grade that
  // unlocks `THRESHOLD_STRONG_EVIDENCE_MIN_SESSIONS`, and therefore the larger
  // 5 s/mi anchor step. The contract's rule for that step is "larger movement
  // requires stronger and more numerous evidence", and a session missing one of
  // its two channels is by definition not stronger evidence.
  //
  // The runner is not penalised for a dead strap: SUBSTANTIAL still counts as
  // evidence, so the ordinary 3 s/mi step remains fully available. What the
  // missing channel costs is the larger step, which is exactly the thing that
  // should cost more.
  //
  // The per-repetition clause, and why it costs the LARGER STEP rather than the
  // grade's status as evidence. A set whose mean sat under the ceiling but
  // whose individual repetitions did not is Q38's SUBSTANTIAL exactly: "the
  // workout still did its job, with an adjustment or small execution
  // difference". It still counts as evidence, so the ordinary 3 s/mi step
  // remains fully available and the runner loses nothing he earned. What it
  // does not do is unlock `THRESHOLD_STRONG_EVIDENCE_MIN_SESSIONS`, because the
  // contract's rule for the larger step is "larger movement requires stronger
  // and more numerous evidence", and a set that ran over its prescribed ceiling
  // on the way home is not stronger evidence that the pace should move.
  //
  // This is the same principle already applied one paragraph above to a missing
  // channel, and `ADAPTATION_PROGRESSION_DOCTRINE`'s own sentence for it: a
  // fast-but-uncontrolled session is not evidence pace should move.
  if (paceCredible && paceWithinTolerance && hrCredible && !hrAboveCeiling && noLateCollapse) {
    return finish(hrSegmentBreach ? 'SUBSTANTIAL' : 'FULL', discountedChannel);
  }

  /* ── SUBSTANTIAL · conditions explain it, the stimulus survived ────────── */

  // The contract's SUBSTANTIAL is specifically "conditions reasonably slowed
  // pace, but HR, effort and structure support the intended stimulus". So it
  // requires a REASON pace is off, not merely that pace is off.
  const structureIntact = workSatisfied && noLateCollapse;
  if (paceDiscounted && hrCredible && !hrAboveCeiling && structureIntact) {
    return finish('SUBSTANTIAL', 'PACE');
  }

  // Pace credible, slightly outside tolerance, everything else supports it.
  if (paceCredible && !paceWithinTolerance && hrCredible && !hrAboveCeiling && structureIntact) {
    // Slower than target with the work complete and HR below its ceiling is a
    // genuinely easier session. That is a different stimulus, not a substantial
    // one, and calling it SUBSTANTIAL is how an engine talks itself into
    // treating an easy day as threshold evidence.
    return finish('DIFFERENT', discountedChannel);
  }

  // HR discounted, pace credible and on target, structure intact.
  if (!input.hrReliable && paceCredible && paceWithinTolerance && structureIntact) {
    return finish('SUBSTANTIAL', 'HR');
  }

  // Everything else: the work happened, but the evidence does not establish the
  // intended stimulus was achieved. Not a failure, and not a claim either.
  return finish('DIFFERENT', discountedChannel);
}

/**
 * Whether a PARTIAL was minimal enough to be worth naming separately in a
 * report. Both grade PARTIAL, because Q38's PARTIAL sentence is true of both;
 * only the detail line differs.
 */
export function isMinimalPartial(input: StimulusInput): boolean {
  if (!input.completedWorkSeconds.ok || input.prescribedWorkSeconds <= 0) return false;
  return input.completedWorkSeconds.value / input.prescribedWorkSeconds
    < STIMULUS_PARTIAL_MIN_WORK_FRAC;
}
