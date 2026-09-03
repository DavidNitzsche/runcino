/**
 * lib/adaptation/canonical/levers/threshold-pace.ts · THE THRESHOLD ANCHOR.
 *
 * `docs/ADAPTATION_ENGINE_CONTRACT.md` "Per-lever evidence contracts ·
 * Threshold pace", and `docs/PROGRESSIVE_BASELINE_DOCTRINE.md` Q20.
 *
 *     "A single training session must never move it."   — Q20
 *
 * ── THE FOUR BOUNDS, AND WHY EACH ONE EXISTS ───────────────────────────────
 *
 *   ≥2 qualifying sessions   · a one-off is noise. Q20's opening sentence.
 *   within 28 days           · older evidence describes a different runner.
 *   clear direction, 2:1     · a MAJORITY, not unanimity. See the long comment
 *                               at the direction check for why requiring zero
 *                               contradiction is a wall rather than a bar.
 *   ≥1 s/mi to be a change   · below that the sessions have established nothing
 *                               and relabelling noise as progress is how an
 *                               anchor starts to bounce.
 *   3 s/mi ordinary, 5 max   · "no same-day oscillation ... it must not make
 *                               the anchor bounce."
 *
 * ── THE ASYMMETRY CHECK RULE 21 DEMANDS ────────────────────────────────────
 *
 * Stated here beside the numbers, as CLAUDE.md requires: this lever's bar to
 * go UP and its bar to come DOWN are THE SAME BAR. `PROGRESS` and `REGRESS`
 * both require `THRESHOLD_MIN_QUALIFYING_SESSIONS` qualifying sessions in the
 * same window, both graded FULL or SUBSTANTIAL, both consistent in direction.
 * The only thing that differs is which way the evidence points.
 *
 * That symmetry is deliberate and it is the point of the whole exercise. The
 * engine Rule 21 measured had five downgrades and zero upgrades because its
 * downward path fired on a single signal while its upward path needed
 * corroboration. Here, one bad session moves nothing either.
 *
 * Falling one session short produces a HOLD that NAMES what is missing, never
 * silence. A lever that can only fail to fire is the Rule 21 defect in a
 * different hat.
 *
 * ── RULE 22 · WHAT THIS LEVER'S GATE CANNOT FAIL ON ────────────────────────
 *
 * It cannot fail on a wrong stimulus grade. Grades arrive from `stimulus.ts`
 * and this file trusts them completely, so a systematically generous grader
 * would produce systematically generous corroboration here and every test would
 * still pass. The stimulus tests are the other half of that check.
 *
 * It also cannot fail on a threshold anchor that is wrong in ABSOLUTE terms.
 * This lever only ever moves the carried belief by a bounded step; if the
 * belief arrived wrong, every proposal is wrong by the same amount and nothing
 * here notices.
 */
import {
  THRESHOLD_MIN_QUALIFYING_SESSIONS,
  THRESHOLD_EVIDENCE_WINDOW_DAYS,
  THRESHOLD_ORDINARY_STEP_SEC_PER_MI,
  THRESHOLD_MAX_STEP_SEC_PER_MI,
  THRESHOLD_STRONG_EVIDENCE_MIN_SESSIONS,
  THRESHOLD_MIN_MEANINGFUL_STEP_SEC_PER_MI,
  CONTRACT_DOC,
} from '../contract-constants';
import type { GradedSession } from '../input';
import { qualifiesAsThresholdEvidence, excluded } from '../admissibility';
import { assessDeterioration } from '../deterioration';
import type {
  ContradictoryEvidence,
  ExcludedEvidence,
  IncludedEvidence,
  Magnitude,
} from '../decision-record';
import { confidenceFrom, daysBetween, nonMoving, paceText, type LeverVerdict } from './shared';
import { roundTo } from '@/lib/format/run';

/**
 * The lever's own slice of the world. No goal, by construction.
 * No readiness, no sleep, no HRV, no resting HR, no training form.
 */
export interface ThresholdPaceInput {
  readonly todayISO: string;
  /** The carried belief. This lever moves it; it never resolves one. */
  readonly currentAnchorSecPerMi: number;
  readonly sessions: readonly GradedSession[];
  /** Contract · no same-day oscillation. */
  readonly anchorMovedToday: boolean;
}

const LEVER = 'THRESHOLD_PACE' as const;

export function evaluateThresholdPace(input: ThresholdPaceInput): LeverVerdict {
  const before = input.currentAnchorSecPerMi;
  const window = THRESHOLD_EVIDENCE_WINDOW_DAYS;

  const included: IncludedEvidence[] = [];
  const excludedList: ExcludedEvidence[] = [];
  const contradictory: ContradictoryEvidence[] = [];

  /* ── Admissibility, session by session ─────────────────────────────────── */

  const qualifying: Array<{
    s: GradedSession;
    paceSecPerMi: number;
    /** Q29 · UNKNOWN when truncation made the late portion unreadable. */
    deterioration: 'CLEAN' | 'UNKNOWN';
  }> = [];

  for (const s of input.sessions) {
    const age = daysBetween(input.todayISO, s.provenance.dateISO);

    if (age > window || age < 0) {
      excludedList.push({
        activityId: s.provenance.activityId,
        dateISO: s.provenance.dateISO,
        reason: 'OUTSIDE_EVIDENCE_WINDOW',
        detail: `The session is ${age} days old, outside the ${window}-day threshold window.`,
        stillAdmissibleFor: ['weekly volume', 'consistency', 'time on feet'],
      });
      continue;
    }

    const verdict = qualifiesAsThresholdEvidence(s);
    if (!verdict.admissible) {
      excludedList.push(excluded(s.provenance.activityId, s.provenance.dateISO, verdict));
      continue;
    }

    // Q20 · "no major late deterioration" is part of qualifying, so a session
    // that fell apart late does not corroborate a faster anchor however quick
    // its average was. This is the doctrine's Example B, enforced.
    const det = assessDeterioration(s.thirds, s.provenance.truncation);
    if (det.verdict === 'DETERIORATED') {
      contradictory.push({
        activityId: s.provenance.activityId,
        dateISO: s.provenance.dateISO,
        detail: `Qualifying work, but it deteriorated late · ${det.signals.join(', ')}.`,
      });
      continue;
    }

    // `workPaceSecPerMi.ok` was already established by the admissibility gate.
    const paceSecPerMi = s.workPaceSecPerMi.ok ? s.workPaceSecPerMi.value : before;
    qualifying.push({ s, paceSecPerMi, deterioration: det.verdict });
  }

  /* ── Separate days · "on separate days" ────────────────────────────────── */

  const byDay = new Map<string, (typeof qualifying)[number]>();
  for (const q of qualifying) {
    const day = q.s.provenance.dateISO.slice(0, 10);
    const held = byDay.get(day);
    // Keep the stronger of two same-day sessions rather than counting both.
    if (!held || q.paceSecPerMi < held.paceSecPerMi) byDay.set(day, q);
  }
  for (const q of qualifying) {
    const day = q.s.provenance.dateISO.slice(0, 10);
    if (byDay.get(day) !== q) {
      excludedList.push({
        activityId: q.s.provenance.activityId,
        dateISO: q.s.provenance.dateISO,
        reason: 'SINGLE_EXCEPTIONAL_PERFORMANCE',
        detail:
          'A second qualifying session on the same day. The contract requires '
          + 'corroboration on separate days, so only the stronger one counts.',
        stillAdmissibleFor: ['weekly volume', 'consistency'],
      });
    }
  }

  const distinct = [...byDay.values()];

  // Q29 · a session admitted on its captured work only carries LESS weight and
  // records WHICH portion was admitted. The contract permits truncated work to
  // price a session ("may give pace or threshold evidence if truncation did not
  // affect them") and requires it to be spent "with reduced confidence and a
  // record of exactly which portions were admitted". Both halves, or the
  // permission is being taken without the condition attached.
  for (const q of distinct) {
    const partial = q.s.provenance.truncation.truncated;
    const base = q.s.grade === 'FULL' ? 1 : 0.5;
    included.push({
      activityId: q.s.provenance.activityId,
      dateISO: q.s.provenance.dateISO,
      what:
        `${q.s.raceDistance ? `${q.s.raceDistance} race` : 'threshold session'} at ${paceText(q.paceSecPerMi)}, graded ${q.s.grade}`
        + (partial
          ? ' · admitted on its completed work intervals only, the recording stopped before the session ended'
          : ''),
      grade: q.s.grade,
      weight: partial ? base / 2 : base,
    });
  }

  const admittedOnPartialRecording = distinct.filter(
    (q) => q.s.provenance.truncation.truncated,
  ).length;

  const confidence = (sentence: string, limitation: string | null = null) =>
    confidenceFrom({
      supportingCount: distinct.length,
      contradictingCount: contradictory.length,
      windowDays: window,
      sentence,
      limitation,
    });

  /* ── No same-day oscillation ───────────────────────────────────────────── */

  if (input.anchorMovedToday) {
    return nonMoving({
      lever: LEVER,
      decision: 'HOLD',
      beforeValue: before,
      included,
      excluded: excludedList,
      contradictory,
      windowDays: window,
      confidence: confidence('The threshold anchor already moved today.'),
      reason:
        'The threshold anchor has already been set today. It stays where it is '
        + 'until the next evaluation boundary.',
      whatWouldChangeIt: ['A new qualifying session on a later day.'],
    });
  }

  /* ── Corroboration ─────────────────────────────────────────────────────── */

  if (distinct.length < THRESHOLD_MIN_QUALIFYING_SESSIONS) {
    const short = THRESHOLD_MIN_QUALIFYING_SESSIONS - distinct.length;
    // Rule 21 · this is a HOLD that names what is missing, not silence.
    return nonMoving({
      lever: LEVER,
      decision: 'HOLD',
      beforeValue: before,
      included,
      excluded: excludedList,
      contradictory,
      windowDays: window,
      confidence: confidence(
        distinct.length === 1
          ? 'This rests on a single threshold session.'
          : 'No qualifying threshold session is available in the window.',
        `Threshold pace moves on at least ${THRESHOLD_MIN_QUALIFYING_SESSIONS} corroborating sessions.`,
      ),
      reason:
        `Threshold pace stays at ${paceText(before)}. `
        + `${distinct.length} qualifying session${distinct.length === 1 ? '' : 's'} in the last ${window} days, `
        + `and the anchor moves on ${THRESHOLD_MIN_QUALIFYING_SESSIONS}.`,
      whatWouldChangeIt: [
        `${short} more qualifying threshold session${short === 1 ? '' : 's'} on separate days within ${window} days, graded FULL or SUBSTANTIAL.`,
        'A well-executed 10K or half, which corroborates with one supporting training session.',
      ],
    });
  }

  /* ── Direction · consistent, or it is not corroboration ────────────────── */

  const faster = distinct.filter((q) => q.paceSecPerMi < before);
  const slower = distinct.filter((q) => q.paceSecPerMi > before);

  // The contract asks for "a consistent direction, without MATERIAL
  // contradictory evidence". The word material is doing real work, and the
  // first draft ignored it by requiring unanimity.
  //
  // The replay is what exposed the cost. On 14 Sep the runner had three
  // qualifying sessions faster than his anchor, including a well-executed 10K,
  // and one slower session from three weeks earlier. Unanimity turned that into
  // a HOLD. Over a real season a runner will always have one off day inside any
  // 28-day window, so a zero-contradiction rule is not a high bar, it is a wall
  // the evidence can never clear. That is precisely the Rule 21 defect this
  // engine exists to correct, and it had reappeared in a new place.
  //
  // A direction is therefore established when the agreeing sessions meet the
  // corroboration bar AND outnumber the disagreeing ones at least two to one.
  // The contrary session is not discarded: it is recorded as contradictory
  // evidence, which lowers the confidence the record reports and blocks the
  // larger step. Contradiction reduces confidence rather than vetoing, exactly
  // as Q20 describes.
  //
  // Applied identically in both directions, per Rule 21.
  const clear = (agree: number, disagree: number) =>
    agree >= THRESHOLD_MIN_QUALIFYING_SESSIONS && agree >= 2 * disagree;

  const agreeFaster = clear(faster.length, slower.length);
  const agreeSlower = clear(slower.length, faster.length);

  // All qualifying sessions landed ON the anchor. They agree with each other
  // AND with the current belief, which is a CONFIRMATION rather than a
  // conflict. Falling through to the contradiction branch below would reach the
  // right decision by the wrong reasoning and then say so out loud: "sessions
  // point in both directions" over evidence that points in neither. A sentence
  // that misdescribes the measurement is a Rule 16 defect even when the
  // decision it accompanies is correct.
  if (faster.length === 0 && slower.length === 0) {
    return nonMoving({
      lever: LEVER,
      decision: 'HOLD',
      beforeValue: before,
      included,
      excluded: excludedList,
      contradictory,
      windowDays: window,
      confidence: confidence(
        `${distinct.length} recent threshold sessions came in at the current anchor.`,
      ),
      reason:
        `Threshold pace stays at ${paceText(before)}. Recent sessions came in at the anchor, `
        + 'which confirms it rather than moving it.',
      whatWouldChangeIt: [
        'Qualifying sessions consistently faster than the anchor, which would move it.',
        'A 10K or half race, which is directly relevant to threshold.',
      ],
    });
  }

  if (!agreeFaster && !agreeSlower) {
    // Contract · "contradiction → HOLD, never a bouncing anchor."
    for (const q of slower.length < faster.length ? slower : faster) {
      contradictory.push({
        activityId: q.s.provenance.activityId,
        dateISO: q.s.provenance.dateISO,
        detail: `Points the other way at ${paceText(q.paceSecPerMi)} against an anchor of ${paceText(before)}.`,
      });
    }
    return nonMoving({
      lever: LEVER,
      decision: 'HOLD',
      beforeValue: before,
      included,
      excluded: excludedList,
      contradictory,
      windowDays: window,
      confidence: confidence(
        'Recent threshold sessions do not agree with each other.',
        'Sessions point in both directions, so neither direction is established.',
      ),
      reason:
        `Threshold pace stays at ${paceText(before)}. Recent sessions point in both `
        + 'directions, so the evidence does not establish a change.',
      whatWouldChangeIt: [
        'Further sessions consistent in one direction.',
        'A 10K or half race, which is directly relevant to threshold.',
      ],
    });
  }

  /* ── Magnitude · bounded, and the bound is named ───────────────────────── */

  // The minority sessions are recorded as contradictory rather than discarded.
  // This is what makes "contradiction reduces confidence" true in the data and
  // not just in the comment: the record reports them, the confidence statement
  // counts them, and `strong` below requires none of them, so a contested
  // direction can take the ordinary step but never the larger one.
  for (const q of agreeFaster ? slower : faster) {
    contradictory.push({
      activityId: q.s.provenance.activityId,
      dateISO: q.s.provenance.dateISO,
      detail: `Points the other way at ${paceText(q.paceSecPerMi)} against an anchor of ${paceText(before)}.`,
    });
  }

  // The mean spans EVERY qualifying session, including the contrary ones, so a
  // contested direction produces a smaller demonstrated change as well as lower
  // confidence. Averaging only the agreeing sessions would let the engine talk
  // itself into a bigger step on weaker evidence.
  const demonstrated = distinct.reduce((a, q) => a + q.paceSecPerMi, 0) / distinct.length;
  const rawDelta = demonstrated - before; // negative is faster

  const allFull = distinct.every((q) => q.s.grade === 'FULL');
  const strong =
    distinct.length >= THRESHOLD_STRONG_EVIDENCE_MIN_SESSIONS
    && allFull
    && contradictory.length === 0
    // A partially recorded session is not "stronger evidence", so it never
    // unlocks the larger step, for the same reason a discounted channel does
    // not produce a FULL grade.
    && admittedOnPartialRecording === 0;

  const limit = strong ? THRESHOLD_MAX_STEP_SEC_PER_MI : THRESHOLD_ORDINARY_STEP_SEC_PER_MI;
  const bounded = Math.sign(rawDelta) * Math.min(Math.abs(rawDelta), limit);

  // Below the meaningful floor the sessions have not established a change. Two
  // faster sessions and one slower one that net out to a third of a second per
  // mile are a runner holding steady, and calling that PROGRESS both overstates
  // the evidence and, repeated week over week, produces the bouncing anchor the
  // contract forbids.
  if (Math.abs(bounded) < THRESHOLD_MIN_MEANINGFUL_STEP_SEC_PER_MI) {
    return nonMoving({
      lever: LEVER,
      decision: 'HOLD',
      beforeValue: before,
      included,
      excluded: excludedList,
      contradictory,
      windowDays: window,
      confidence: confidence(
        `${distinct.length} recent threshold sessions, pointing in different directions.`,
        'The sessions do not agree closely enough to establish a change.',
      ),
      reason:
        `Threshold pace stays at ${paceText(before)}. Recent sessions are split either side of `
        + 'the anchor and average out to no meaningful change.',
      whatWouldChangeIt: [
        'Qualifying sessions consistently on one side of the anchor.',
        'A 10K or half race, which is directly relevant to threshold.',
      ],
    });
  }

  const magnitude: Magnitude = {
    unit: 'sec_per_mi',
    value: roundTo(bounded),
    limit,
    limitConstant: strong ? 'THRESHOLD_MAX_STEP_SEC_PER_MI' : 'THRESHOLD_ORDINARY_STEP_SEC_PER_MI',
    limitCitation: `${CONTRACT_DOC} · Threshold pace · "~3-5 s/mi ordinary confirmed update"`,
  };

  const after = roundTo(before + magnitude.value);

  const sentence = `This is supported by ${distinct.length} recent threshold sessions.`;
  // Both limitations can be true at once, and an either/or would silently drop
  // one. A confidence statement that can only hold one caveat will always drop
  // the one the reader most needed.
  const limitations: string[] = [];
  if (Math.abs(rawDelta) > limit) {
    limitations.push(
      `The evidence suggests more than ${limit} s/mi. The step is held to the bound and re-evaluated at the next boundary.`,
    );
  }
  if (admittedOnPartialRecording > 0) {
    limitations.push(
      `${admittedOnPartialRecording} of these sessions was admitted on its completed work intervals only, because the recording stopped early. It counts for less.`,
    );
  }
  // `check-coercion.sh` flags `x.length > 0 ? y : null` as zero-erasure, and it
  // is right to: the shape is indistinguishable at a glance from one that turns
  // a real measured zero into an absence. Here the zero is "no caveats apply",
  // which genuinely is an absence, so the meaning is correct and only the shape
  // needed changing.
  const hasLimitation = limitations.length !== 0;
  const limitation = hasLimitation ? limitations.join(' ') : null;

  return {
    lever: LEVER,
    decision: agreeFaster ? 'PROGRESS' : 'REGRESS',
    beforeValue: before,
    proposedAfterValue: after,
    magnitude,
    included,
    excluded: excludedList,
    contradictory,
    windowDays: window,
    confidence: confidenceFrom({
      supportingCount: distinct.length,
      contradictingCount: contradictory.length,
      windowDays: window,
      sentence,
      limitation,
    }),
    reason: agreeFaster
      ? `Threshold pace moves from ${paceText(before)} to ${paceText(after)}. `
        + `${distinct.length} sessions on separate days in the last ${window} days ran faster than the anchor and held together to the finish.`
      : `Threshold pace eases from ${paceText(before)} to ${paceText(after)}. `
        + `${distinct.length} sessions on separate days came in slower than the anchor, so the anchor is being asked for a pace the recent work does not support.`,
    whatWouldChangeIt: agreeFaster
      ? [
        'A qualifying session slower than the new anchor, which would hold it.',
        'A 10K or half race, which would confirm or correct it directly.',
      ]
      : [
        'A qualifying session at or faster than the current anchor, which would hold it.',
        'A 10K or half race, which would confirm or correct it directly.',
      ],
  };
}
