/**
 * lib/adaptation/canonical/levers/weekly-volume.ts · SUSTAINABLE WEEKLY VOLUME.
 *
 * `docs/ADAPTATION_ENGINE_CONTRACT.md` "Per-lever evidence contracts · Weekly
 * volume" (Q21).
 *
 * ── THE SENTENCE THAT SHAPES THIS FILE MORE THAN THE CRITERIA DO ───────────
 *
 *     "Three successful weeks should authorize a proposal, not force one. The
 *      engine may still HOLD if the existing plan already provides sufficient
 *      progression."
 *
 * So meeting every criterion is necessary and NOT sufficient. `planAlreadyProgresses`
 * below is that clause, and it is the difference between a coach and a
 * ratchet: a baseline that already steps the runner up next week does not need
 * an adaptation on top, and stacking one would be the engine competing with its
 * own plan rather than personalising it.
 *
 * ── WHAT THIS LEVER MAY NOT DO ─────────────────────────────────────────────
 *
 *     "does not automatically raise long-run distance or workout intensity."
 *
 * Structurally guaranteed: this file returns a `weekly_mi` magnitude and has no
 * access to a long-run or pace value at all. The long run has its own contract,
 * its own evidence and its own file, and the arbitration layer is where the two
 * meet. The contract's reciprocal rule is enforced in the long-run lever:
 * "Faster threshold work must never independently authorize a longer long run."
 *
 * ── RULE 21 · THE BAR UP AGAINST THE BAR DOWN ──────────────────────────────
 *
 * PROGRESS needs three consecutive weeks at 95%. REGRESS needs the same three
 * weeks to have MISSED that bar, with readable data proving they were missed
 * rather than unrecorded. Neither direction fires on one week, and neither
 * fires on absent data.
 *
 * The paragraph above used to end "the asymmetry that produced five downgrades
 * and zero upgrades is not reproduced here", and it was WRONG — an unenforced
 * claim in a header, which Rule 20 says is worse than silence because it stops
 * the next reader checking. Replayed against the owner's real history the file
 * produced 15 REGRESS records and 0 PROGRESS, and the asymmetry was structural
 * and one line long: `stepsTakenThisCycle >= VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE`
 * sat BELOW the REGRESS branch's early return, so the contract's "one step per
 * cutback cycle" bound governed only the upward path. The same three missed
 * July weeks were therefore re-spent at every weekly boundary, each time
 * multiplying the belief down again: 43.5 mi/wk to 30.2 across seven applied
 * steps off what was substantially one piece of evidence.
 *
 * The bound is now checked ONCE, above both branches, in the lever's own units
 * and with the same constant. That is not a loosened guard: the contract's
 * `VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE` is applied to more of this file than it
 * was, not to less. Rule 21's instruction is to put a threshold beside its
 * opposite number and justify any asymmetry; there is no citation for one here,
 * because the contract does not define a REGRESS at all. This lever's REGRESS
 * is the engine's own construction and its own stated rule for it is "the same
 * bar, the other way", so the cadence bound travels with it.
 *
 * ── RULE 21 · THE THREE CONDITIONS THIS LEVER USED TO ENFORCE BUT NOT STATE ─
 *
 * Q21 lists five criteria and this file checks all five, so the accusation
 * that it enforces UNDECLARED conditions is, on its face, wrong: "Key sessions
 * FULL or defensible SUBSTANTIAL" and "Relevant long runs substantially
 * completed" are both in the contract, in writing.
 *
 * What was undeclared is how they were READ, and the replay measured the cost.
 * Crediting every one of his non-cutback weeks at exactly the 95% bar bought
 * ZERO of 13 weekly boundaries a PROGRESS: the headline criterion, met in full,
 * changed nothing. Three separate reasons, all of them here rather than in the
 * contract:
 *
 * 1 · **The long-run criterion had no window at all.** `shortLongRuns` and the
 *     deterioration walk read `input.longRuns` WHOLE while the weeks were
 *     windowed to three. His 2026-07-05 long run — a week he did not run — was
 *     still cited as contradictory evidence against the 2026-08-31 decision,
 *     eight weeks later. Q21 says "RELEVANT long runs", and Rule 14 says a
 *     query names the population it reads. It now reads the long runs inside
 *     the weeks this decision is judging, which is what "relevant" means.
 *
 * 2 · **The complement of "counts as evidence" was spent as counter-evidence.**
 *     `GRADES_THAT_COUNT_AS_EVIDENCE` is FULL and SUBSTANTIAL, and its own doc
 *     comment says why DIFFERENT is not in it: "a different stimulus may still
 *     be useful, but it is evidence about the lever it actually tested, not
 *     about the one that was prescribed." This file then took every grade
 *     outside that set and pushed it into `contradictory`, turning "not
 *     evidence FOR" into "evidence AGAINST" — which is Rule 11's collapse, and
 *     the grader is explicit about the fact it destroys. Its own fallback
 *     branch returns DIFFERENT with the comment "the work happened, but the
 *     evidence does not establish the intended stimulus was achieved. Not a
 *     failure, and not a claim either." Five of his June sessions graded
 *     DIFFERENT and blocked a volume step on that reading.
 *
 *     PARTIAL still blocks, and must: Q38 defines it as "not enough of the
 *     intended session to receive the full training effect", which is a
 *     load-absorption fact and exactly what this lever asks about.
 *     INSUFFICIENT is excluded rather than counted, per Q38's "never translate
 *     insufficient evidence into a bad workout".
 *
 * 3 · **A window of sessions that established nothing read as "criterion
 *     satisfied".** The old test was `badKeySessions.length === 0`, which a
 *     window whose every session graded DIFFERENT or INSUFFICIENT passes
 *     vacuously. Q21's criterion is a POSITIVE one — key sessions FULL or
 *     defensible SUBSTANTIAL — so key sessions that ran and established nothing
 *     are a refusal, not a pass. That is the same clause tightening as the two
 *     above loosen, and it is deliberate: this change is about reading each
 *     fact as the fact it is, not about lowering a bar.
 *
 *     It does NOT fire on a window with no key sessions at all, which is a
 *     base block prescribing only easy running. The first draft did, and
 *     `_symmetry.test.ts` failed with the sentence this file exists to prevent:
 *     "the upward path is unreachable on its own criterion, which is a wall."
 *
 * Rule 8 is also now applied PER FINDING rather than only per week. The lever
 * already drops taper and recovery WEEKS from the completion test; it kept
 * grading the sessions and long runs inside those same weeks. A key session
 * run during a prescribed taper is not evidence about what he can absorb.
 *
 * ── RULE 22 · WHAT THIS LEVER'S GATE CANNOT FAIL ON ────────────────────────
 *
 * It cannot fail on a prescribed week that was itself too small. Completion is
 * measured against what was prescribed, so a runner who hits 95% of an
 * under-prescribed week looks identical to one who hits 95% of a correct week.
 * Whether the baseline is aggressive enough is the plan generator's question
 * and this lever cannot see it.
 *
 * It cannot fail on a week that was mis-attributed rather than missed. A week
 * whose activities landed on the wrong dates reads as a shortfall and there is
 * nothing here that could tell the difference; `dataComplete` is a flag this
 * file trusts rather than verifies.
 *
 * It cannot tell "the plan prescribed no quality that week" from "the plan
 * prescribed quality and none of it was run". `keySessions` carries GRADED
 * sessions, so a prescribed session nobody ran never arrives here at all, and
 * both cases reach this file as an empty window. It is read as the first,
 * because a base block is the common case and walling it would be worse; the
 * second would be better answered by an input that carried what was PRESCRIBED
 * alongside what was graded, and no such field exists. Named rather than
 * silently assumed, per Rule 11.
 *
 * It cannot fail on a WRONG GRADE. Every clause above moves a session between
 * "supports", "blocks" and "neither" by reading `s.grade`, and if the stimulus
 * grader mis-grades a session this file will confidently spend the wrong
 * verdict. On the real replay 13 of his 24 quality sessions graded PARTIAL or
 * DIFFERENT, and whether that census is right is `stimulus.ts`'s question, not
 * this one's.
 */
import {
  VOLUME_MIN_CONSECUTIVE_WEEKS,
  VOLUME_WEEK_COMPLETION_MIN_FRAC,
  VOLUME_MAX_STEP_FRAC,
  VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE,
  CONTRACT_DOC,
} from '../contract-constants';
import type { GradedSession, LongRunObservation, WeekObservation } from '../input';
import { prescribedNonNormalWeek } from '../input';
import { GRADES_THAT_COUNT_AS_EVIDENCE } from '../stimulus';
import { assessDeterioration, deteriorationPattern } from '../deterioration';
import { LONG_RUN_COMPLETION_MIN_FRAC } from '../contract-constants';
import type {
  ContradictoryEvidence,
  ExcludedEvidence,
  IncludedEvidence,
  Magnitude,
} from '../decision-record';
import { confidenceFrom, meetsCompletionBar, miText, nonMoving, type LeverVerdict } from './shared';
import { roundTo } from '@/lib/format/run';

export interface WeeklyVolumeInput {
  readonly todayISO: string;
  /** The carried belief about sustainable weekly volume. */
  readonly currentWeeklyMi: number;
  /** Most recent LAST. The lever reads the tail. */
  readonly weeks: readonly WeekObservation[];
  readonly keySessions: readonly GradedSession[];
  readonly longRuns: readonly LongRunObservation[];
  /** The week a proposal would affect. */
  readonly nextWeekPrescribedMi: number;
  /** Upward steps already taken in this cutback cycle. */
  readonly stepsTakenThisCycle: number;
}

const LEVER = 'WEEKLY_VOLUME' as const;

export function evaluateWeeklyVolume(input: WeeklyVolumeInput): LeverVerdict {
  const before = input.currentWeeklyMi;

  const included: IncludedEvidence[] = [];
  const excludedList: ExcludedEvidence[] = [];
  const contradictory: ContradictoryEvidence[] = [];

  /* ── The relevant weeks · non-cutback, most recent first ───────────────── */

  // Rule 8, and the reason it is resolved by `prescribedNonNormalWeek` rather
  // than by reading `w.isCutback` here: the real production row for the owner's
  // post-race recovery block says `is_cutback FALSE` on two weeks the plan
  // itself was authored `mode: 'recovery'` to prescribe as recovery. A Rule 8
  // protection resting on one boolean is a protection resting on one column
  // being right, and that column was not.
  const nonCutback: WeekObservation[] = [];
  for (const w of [...input.weeks].reverse()) {
    const intent = prescribedNonNormalWeek(w);
    if (intent.nonNormal) {
      excludedList.push({
        activityId: `week:${w.weekStartISO}`,
        dateISO: w.weekStartISO,
        reason: 'PRESCRIBED_RECOVERY_OR_TAPER',
        detail: intent.detail,
        stillAdmissibleFor: ['consistency', 'time on feet'],
      });
      continue;
    }
    nonCutback.push(w);
    if (nonCutback.length >= VOLUME_MIN_CONSECUTIVE_WEEKS) break;
  }

  const windowDays = VOLUME_MIN_CONSECUTIVE_WEEKS * 7;
  const conf = (sentence: string, limitation: string | null = null) =>
    confidenceFrom({
      supportingCount: included.length,
      contradictingCount: contradictory.length,
      windowDays,
      sentence,
      limitation,
    });

  if (nonCutback.length < VOLUME_MIN_CONSECUTIVE_WEEKS) {
    return nonMoving({
      lever: LEVER,
      decision: 'REFUSE',
      beforeValue: before,
      excluded: excludedList,
      windowDays,
      confidence: conf(
        `Only ${nonCutback.length} non-cutback weeks are available.`,
        `Weekly volume moves on ${VOLUME_MIN_CONSECUTIVE_WEEKS} consecutive non-cutback weeks.`,
      ),
      reason:
        `Weekly volume stays at ${miText(before)}. There are only ${nonCutback.length} `
        + `non-cutback weeks to read, and the contract asks for ${VOLUME_MIN_CONSECUTIVE_WEEKS}.`,
      whatWouldChangeIt: [
        `${VOLUME_MIN_CONSECUTIVE_WEEKS - nonCutback.length} more completed non-cutback weeks.`,
      ],
    });
  }

  /* ── Rule 11 · a week nobody could read is not a week at zero ──────────── */

  const unreadable = nonCutback.filter((w) => !w.completedMi.ok || !w.dataComplete);
  if (unreadable.length > 0) {
    for (const w of unreadable) {
      excludedList.push({
        activityId: `week:${w.weekStartISO}`,
        dateISO: w.weekStartISO,
        reason: 'DATA_UNREADABLE',
        detail: !w.completedMi.ok
          ? 'Completed mileage for this week could not be read.'
          : 'The week contains missing, duplicate or misattributed activity data.',
        stillAdmissibleFor: [],
      });
    }
    return nonMoving({
      lever: LEVER,
      decision: 'REFUSE',
      beforeValue: before,
      excluded: excludedList,
      windowDays,
      confidence: conf(
        `${unreadable.length} of the ${VOLUME_MIN_CONSECUTIVE_WEEKS} relevant weeks could not be read.`,
        'Missing data is not successful training, and it is not a missed week either.',
      ),
      reason:
        `Weekly volume stays at ${miText(before)}. `
        + `${unreadable.length} of the last ${VOLUME_MIN_CONSECUTIVE_WEEKS} weeks has incomplete data, `
        + 'so the progression cannot be evaluated either way.',
      whatWouldChangeIt: [
        'The missing activity data being corrected or re-synced.',
        'A further complete week, which would move the window past the gap.',
      ],
    });
  }

  /* ── Completion ────────────────────────────────────────────────────────── */

  const completions = nonCutback.map((w) => ({
    week: w,
    frac: w.completedMi.ok && w.prescribedMi > 0 ? w.completedMi.value / w.prescribedMi : 0,
  }));

  for (const c of completions) {
    const entry: IncludedEvidence = {
      activityId: `week:${c.week.weekStartISO}`,
      dateISO: c.week.weekStartISO,
      what: `${miText(c.week.completedMi.ok ? c.week.completedMi.value : 0)} of ${miText(c.week.prescribedMi)} prescribed, ${Math.round(c.frac * 100)}%`,
      grade: null,
      weight: 1,
    };
    if (meetsCompletionBar(c.frac, VOLUME_WEEK_COMPLETION_MIN_FRAC)) included.push(entry);
    else {
      contradictory.push({
        activityId: entry.activityId,
        dateISO: entry.dateISO,
        detail: `Week completed at ${Math.round(c.frac * 100)}%, below the ${Math.round(VOLUME_WEEK_COMPLETION_MIN_FRAC * 100)}% bar.`,
      });
    }
  }

  const allWeeksMet = completions.every((c) => meetsCompletionBar(c.frac, VOLUME_WEEK_COMPLETION_MIN_FRAC));

  /* ── Key sessions · FULL or defensible SUBSTANTIAL ─────────────────────── */

  // ── THE WINDOW THAT WAS MISSING ────────────────────────────────────────
  //
  // `weeks` is windowed to `VOLUME_MIN_CONSECUTIVE_WEEKS` above; `keySessions`
  // was not windowed at all. It received `input.qualitySessions` whole and
  // marked every session below SUBSTANTIAL as contradictory FOREVER, so the
  // 2026-09-02 volume record carried 19 contradictory items, one of which was
  // "2026-06-11 A key session graded DIFFERENT" — a June session contradicting
  // a September decision. Nothing in `input.ts` said the caller must
  // pre-window, so the lever windows its own evidence, which is where the
  // decision about what is relevant to THIS question belongs.
  //
  // The window is not a new number. It is the span of the weeks this lever
  // actually read, so the sessions considered are exactly the sessions inside
  // the weeks being judged. A separate constant here would be a second opinion
  // about the same window (Rule 16).
  const evidenceFromISO = nonCutback.length > 0
    ? nonCutback[nonCutback.length - 1].weekStartISO
    : input.todayISO;

  /**
   * Rule 8, applied PER FINDING rather than only per week.
   *
   * The weeks the plan prescribed as taper or recovery are already dropped
   * from the completion test above. The sessions and long runs INSIDE those
   * same weeks were still being graded, so a taper session that missed a
   * meaningful portion of a deliberately reduced prescription read as evidence
   * he cannot absorb his volume. The locked per-finding context-filter rule is
   * explicit that a parent guard does not propagate to a child observation.
   *
   * A date is inside a non-normal week when it falls in the seven days from
   * that week's start. Same arithmetic as `weekStartOf`, and there is no
   * calendar helper on this side of the engine to borrow.
   */
  const nonNormalWeekStarts = input.weeks
    .filter((w) => prescribedNonNormalWeek(w).nonNormal)
    .map((w) => w.weekStartISO);
  const DAY_MS = 86_400_000;
  const insidePrescribedNonNormalWeek = (dateISO: string): string | null => {
    const t = Date.parse(`${dateISO}T12:00:00Z`);
    for (const ws of nonNormalWeekStarts) {
      const s = Date.parse(`${ws}T12:00:00Z`);
      if (t >= s && t < s + 7 * DAY_MS) return ws;
    }
    return null;
  };

  for (const s of input.keySessions) {
    if (s.provenance.dateISO >= evidenceFromISO) continue;
    excludedList.push({
      activityId: s.provenance.activityId,
      dateISO: s.provenance.dateISO,
      reason: 'OUTSIDE_EVIDENCE_WINDOW',
      detail:
        `The session predates ${evidenceFromISO}, the first of the `
        + `${VOLUME_MIN_CONSECUTIVE_WEEKS} weeks this decision reads.`,
      stillAdmissibleFor: ['consistency', 'time on feet', 'the fact that the workout occurred'],
    });
  }

  const keySessionsInWindow: GradedSession[] = [];
  for (const s of input.keySessions) {
    if (s.provenance.dateISO < evidenceFromISO) continue;
    const ws = insidePrescribedNonNormalWeek(s.provenance.dateISO);
    if (ws !== null) {
      excludedList.push({
        activityId: s.provenance.activityId,
        dateISO: s.provenance.dateISO,
        reason: 'PRESCRIBED_RECOVERY_OR_TAPER',
        detail:
          `The session sits inside the week of ${ws}, which the plan prescribed as `
          + 'taper or recovery. A session run during a week the plan told him to reduce '
          + 'is not evidence about what he can absorb.',
        stillAdmissibleFor: ['consistency', 'time on feet', 'the fact that the workout occurred'],
      });
      continue;
    }
    keySessionsInWindow.push(s);
  }

  /* ── The three facts a grade can be, kept apart (Rule 11) ──────────────── */

  // Q21 · "Key sessions FULL or defensible SUBSTANTIAL". This is the POSITIVE
  // half of the criterion, and it is what `GRADES_THAT_COUNT_AS_EVIDENCE`
  // means. Its complement is "does not support", not "argues against".
  const supportingKeySessions = keySessionsInWindow.filter(
    (s) => GRADES_THAT_COUNT_AS_EVIDENCE.has(s.grade),
  );
  for (const s of supportingKeySessions) {
    included.push({
      activityId: s.provenance.activityId,
      dateISO: s.provenance.dateISO,
      what: `A key session graded ${s.grade}.`,
      grade: s.grade,
      weight: 1,
    });
  }

  // Q38 · PARTIAL is "not enough of the intended session to receive the full
  // training effect". That is a statement about work NOT ABSORBED, which is
  // precisely the question this lever asks, so it blocks — the one grade below
  // the bar that genuinely contradicts a volume increase.
  const badKeySessions = keySessionsInWindow.filter((s) => s.grade === 'PARTIAL');
  for (const s of badKeySessions) {
    contradictory.push({
      activityId: s.provenance.activityId,
      dateISO: s.provenance.dateISO,
      detail: 'A key session graded PARTIAL · a meaningful portion of the prescribed work was missed.',
    });
  }

  // DIFFERENT and INSUFFICIENT: neither support nor block.
  //
  // DIFFERENT · Q38 · "a different stimulus may still be useful; it is not
  // failure", and Q27 · "a session prescribed at a deliberately different
  // effort supports the lever it actually tests, not the lever its nominal
  // label implies". The work happened and the miles counted toward the week;
  // what it does not do is establish the intended stimulus.
  //
  // INSUFFICIENT · Q38 · "Never translate insufficient evidence into a bad
  // workout."
  for (const s of keySessionsInWindow) {
    if (s.grade !== 'DIFFERENT' && s.grade !== 'INSUFFICIENT') continue;
    excludedList.push({
      activityId: s.provenance.activityId,
      dateISO: s.provenance.dateISO,
      reason: s.grade === 'INSUFFICIENT' ? 'DATA_UNREADABLE' : 'GRADE_DOES_NOT_COUNT',
      detail: s.grade === 'INSUFFICIENT'
        ? 'The session could not be graded reliably, which is not the same as a session that went badly.'
        : 'The session achieved a different stimulus from the one prescribed. It is evidence '
          + 'about the lever it actually tested, and its miles still counted toward the week.',
      stillAdmissibleFor: ['weekly volume', 'consistency', 'time on feet'],
    });
  }

  /* ── Long runs substantially completed ─────────────────────────────────── */

  // Q29, and a defect the historical replay caught. A TRUNCATED long run reads
  // as 11.2 of a prescribed 15 and looks identical to a run the runner cut
  // short, but the contract is explicit that they are different facts:
  //
  //     "Count only recorded distance and duration ... the missing portion is
  //      not failed training."
  //     "Do not allow one known small truncation to invalidate an entire
  //      multi-week progression automatically."
  //
  // Counting it as a shortfall held a volume progression that three completed
  // weeks had genuinely earned, on the strength of a watch battery. So a
  // truncated long run is EXCLUDED here with its reason recorded, rather than
  // counted against him.
  //
  // Note this lever and the long-run lever now treat the same activity
  // differently, and that is Q27's lever-specific representativeness working
  // as intended rather than an inconsistency. The long-run lever refuses on it
  // because it is asking about DURABILITY, which truncation makes unknowable.
  // This lever is asking whether the WEEKS were completed, and the recorded
  // miles answer that perfectly well.
  // ── THE WINDOW THAT WAS STILL MISSING ──────────────────────────────────
  //
  // The key sessions were windowed; the long runs were not. `input.longRuns`
  // arrived whole, so his 2026-07-05 long run — a week in which he did not run
  // at all — was still listed as contradictory evidence against the 2026-08-31
  // decision, and three separate July long runs were re-spent at every
  // boundary from August onward.
  //
  // Q21's own word is "RELEVANT long runs substantially completed", and Rule
  // 14 says a query names the population it reads. The relevant population is
  // the long runs inside the weeks this decision is judging — the same
  // `evidenceFromISO` the key sessions use, because a second constant here
  // would be a second opinion about one window (Rule 16). Rule 8's per-finding
  // filter applies to them too.
  const longRunsInWindow: LongRunObservation[] = [];
  for (const l of input.longRuns) {
    if (l.provenance.dateISO < evidenceFromISO) {
      excludedList.push({
        activityId: l.provenance.activityId,
        dateISO: l.provenance.dateISO,
        reason: 'OUTSIDE_EVIDENCE_WINDOW',
        detail:
          `The long run predates ${evidenceFromISO}, the first of the `
          + `${VOLUME_MIN_CONSECUTIVE_WEEKS} weeks this decision reads.`,
        stillAdmissibleFor: ['consistency', 'time on feet', 'the long-run lever'],
      });
      continue;
    }
    const ws = insidePrescribedNonNormalWeek(l.provenance.dateISO);
    if (ws !== null) {
      excludedList.push({
        activityId: l.provenance.activityId,
        dateISO: l.provenance.dateISO,
        reason: 'PRESCRIBED_RECOVERY_OR_TAPER',
        detail:
          `The long run sits inside the week of ${ws}, which the plan prescribed as `
          + 'taper or recovery. A shortened long run the plan asked for is not a long run he missed.',
        stillAdmissibleFor: ['consistency', 'time on feet'],
      });
      continue;
    }
    longRunsInWindow.push(l);
  }

  const truncatedLongRuns = longRunsInWindow.filter((l) => l.provenance.truncation.truncated);
  for (const l of truncatedLongRuns) {
    excludedList.push({
      activityId: l.provenance.activityId,
      dateISO: l.provenance.dateISO,
      reason: 'TRUNCATED_PORTION_REQUIRED',
      detail:
        'The recording stopped early, so the prescribed distance cannot be checked. '
        + 'The recorded miles still count toward the week. The missing portion is not '
        + 'failed training.',
      stillAdmissibleFor: ['weekly volume', 'recorded distance', 'time on feet'],
    });
  }

  const shortLongRuns = longRunsInWindow.filter(
    (l) => !l.provenance.truncation.truncated
      && l.completedMi.ok && l.prescribedMi > 0
      && !meetsCompletionBar(l.completedMi.value / l.prescribedMi, LONG_RUN_COMPLETION_MIN_FRAC),
  );
  for (const l of shortLongRuns) {
    contradictory.push({
      activityId: l.provenance.activityId,
      dateISO: l.provenance.dateISO,
      detail: 'A relevant long run was not substantially completed.',
    });
  }

  /* ── No repeated late deterioration ────────────────────────────────────── */

  // Q21 · "No REPEATED meaningful late-session deterioration", read over the
  // same population as every other criterion above. It walked `input.longRuns`
  // whole, which is the same unbounded-window defect: a session that fell away
  // in June was still counting toward "repeated" in September.
  const pattern = deteriorationPattern([
    ...keySessionsInWindow.map((s) => assessDeterioration(s.thirds, s.provenance.truncation)),
    ...longRunsInWindow.map((l) => assessDeterioration(l.thirds, l.provenance.truncation)),
  ]);

  /* ── HOLD paths, each naming exactly what is missing ───────────────────── */

  const holdBecause = (reason: string, missing: string[], sentence: string) =>
    nonMoving({
      lever: LEVER,
      decision: 'HOLD',
      beforeValue: before,
      included,
      excluded: excludedList,
      contradictory,
      windowDays,
      confidence: conf(sentence),
      reason,
      whatWouldChangeIt: missing,
    });

  /* ── The cadence bound · ABOVE both branches, which is the fix ─────────── */

  // See the header. This check used to sit below the REGRESS early return, so
  // "one step per cutback cycle" governed only the upward path and the same
  // three missed weeks were re-spent at every weekly boundary. It is checked
  // once, before either direction may move, in this lever's own units.
  //
  // Rule 21 asks for the bar up beside the bar down. They are now the same
  // line of code, so there is nothing left to justify.
  if (input.stepsTakenThisCycle >= VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE) {
    return holdBecause(
      `Weekly volume stays at ${miText(before)}. It has already moved once in `
      + 'this cycle, and the contract allows one step per cutback cycle.',
      ['The next cutback boundary, after which the lever is available again.'],
      'The evidence supports a change. The cycle does not.',
    );
  }

  /* ── REGRESS · the same bar, pointing the other way ────────────────────── */

  const allWeeksMissed = completions.every((c) => !meetsCompletionBar(c.frac, VOLUME_WEEK_COMPLETION_MIN_FRAC));
  if (allWeeksMissed) {
    // ── THE TWO QUANTITIES, AND WHY THE PROPOSAL NOW READS THE RIGHT ONE ──
    //
    // `allWeeksMissed` is measured against what the PLAN PRESCRIBED. The value
    // it moves is the carried BELIEF about sustainable weekly volume. Rule 16:
    // two different quantities under one decision, and on the owner's real
    // history they pointed opposite ways. At 2026-08-17 the belief was cut to
    // 33.5 mi/wk while two of the three weeks in the window read 39.8 and 47.5
    // mi completed. Every week had missed a 46-64 mi prescription written by
    // the PREVIOUS block, and the sentence "the prescribed level is running
    // ahead of what is being absorbed" was true of the prescription and false
    // of the number it moved.
    //
    // So the proposal is floored at the volume he DEMONSTRABLY RAN across the
    // same weeks. That floor is continuous, monotone in the evidence, and
    // cannot walk the belief below work he has actually done. It is not a
    // weakened guard: the doctrine step bound `VOLUME_MAX_STEP_FRAC` still
    // applies unchanged and still bounds how far one step may fall.
    const mean = completions.reduce((a, c) => a + c.frac, 0) / completions.length;
    const demonstratedMi = roundTo(
      completions.reduce((a, c) => a + (c.week.completedMi.ok ? c.week.completedMi.value : 0), 0)
      / completions.length,
    );

    // Missing a bigger prescription and being unable to carry this level are
    // opposite facts (Rule 11). When the mean he actually ran already meets the
    // belief, the evidence is about the prescription, not about the belief.
    if (demonstratedMi >= before) {
      return holdBecause(
        `Weekly volume stays at ${miText(before)}. `
        + `The last ${VOLUME_MIN_CONSECUTIVE_WEEKS} non-cutback weeks all came in below what was `
        + `prescribed, but they averaged ${miText(demonstratedMi)}, which is already at or above `
        + `${miText(before)}. What was missed was a larger prescription, not this level.`,
        [
          `A week completed at ${Math.round(VOLUME_WEEK_COMPLETION_MIN_FRAC * 100)}% of prescribed, `
          + 'which would let the level move rather than hold.',
          `A run of weeks averaging below ${miText(before)}, which would ease the level.`,
        ],
        `All ${VOLUME_MIN_CONSECUTIVE_WEEKS} weeks missed their prescription, and all `
        + `${VOLUME_MIN_CONSECUTIVE_WEEKS} averaged ${miText(demonstratedMi)}.`,
      );
    }

    const proposed = roundTo(before * mean);
    const cap = before * VOLUME_MAX_STEP_FRAC;
    const bounded = Math.min(
      before,
      Math.max(proposed, roundTo(before - cap), demonstratedMi),
    );
    return {
      lever: LEVER,
      decision: 'REGRESS',
      beforeValue: before,
      proposedAfterValue: bounded,
      magnitude: {
        unit: 'weekly_mi',
        value: roundTo(bounded - before),
        limit: roundTo(cap),
        limitConstant: 'VOLUME_MAX_STEP_FRAC',
        limitCitation: `${CONTRACT_DOC} · Weekly volume · "≤~5% above the affected prescribed week"`,
      },
      included,
      excluded: excludedList,
      contradictory,
      windowDays,
      confidence: conf(
        `All ${VOLUME_MIN_CONSECUTIVE_WEEKS} recent non-cutback weeks came in under the prescribed volume.`,
      ),
      reason:
        `Weekly volume eases from ${miText(before)} to ${miText(bounded)}. `
        + `The last ${VOLUME_MIN_CONSECUTIVE_WEEKS} non-cutback weeks all came in below what was prescribed, `
        + `and averaged ${miText(demonstratedMi)}, so the prescribed level is running ahead of what is `
        + 'being absorbed.',
      whatWouldChangeIt: [
        'A completed week at the prescribed volume, which would hold the current level.',
      ],
    };
  }

  if (!allWeeksMet) {
    const missed = completions.filter((c) => !meetsCompletionBar(c.frac, VOLUME_WEEK_COMPLETION_MIN_FRAC)).length;
    return holdBecause(
      `Weekly volume stays at ${miText(before)}. `
      + `${missed} of the last ${VOLUME_MIN_CONSECUTIVE_WEEKS} non-cutback weeks came in below `
      + `${Math.round(VOLUME_WEEK_COMPLETION_MIN_FRAC * 100)}% of prescribed.`,
      [`${VOLUME_MIN_CONSECUTIVE_WEEKS} consecutive non-cutback weeks at ${Math.round(VOLUME_WEEK_COMPLETION_MIN_FRAC * 100)}% or better.`],
      `${VOLUME_MIN_CONSECUTIVE_WEEKS - missed} of ${VOLUME_MIN_CONSECUTIVE_WEEKS} recent weeks met the bar.`,
    );
  }

  if (badKeySessions.length > 0) {
    return holdBecause(
      `Weekly volume stays at ${miText(before)}. The weeks were completed, but `
      + `${badKeySessions.length} key session came in short of the work it prescribed.`,
      ['Key sessions in the next block completed as prescribed.'],
      'The weekly totals were there. The prescribed sessions inside them were not.',
    );
  }

  /* ── Rule 11 · sessions that established nothing are not sessions that ───
   *              went well, and they are not an absence of sessions either ── */

  // Q21 asks for "key sessions FULL or defensible SUBSTANTIAL". The old test
  // was `badKeySessions.length === 0`, which a window whose every session
  // graded DIFFERENT or INSUFFICIENT passes without reading anything — the
  // vacuous-truth shape Rule 11 exists to stop.
  //
  // The condition is deliberately NOT "no supporting session": a window with
  // NO key sessions at all is a base block, where the plan prescribed only
  // easy running, and Q21's criterion is vacuously satisfied because there is
  // nothing for it to be false of. `_symmetry.test.ts` caught the first draft
  // of this clause doing the other thing and named it correctly — "the upward
  // path is unreachable on its own criterion, which is a wall" — which is the
  // Rule 21 defect this whole change exists to remove, reintroduced by the fix
  // for it. A base-phase runner must be able to earn a volume step on easy
  // running alone.
  //
  // So the refusal fires only when key sessions WERE run in the window and
  // none of them established its intended stimulus. That is missing evidence
  // about work that happened, which is a different fact from work that was
  // never prescribed.
  if (keySessionsInWindow.length > 0 && supportingKeySessions.length === 0) {
    return nonMoving({
      lever: LEVER,
      decision: 'REFUSE',
      beforeValue: before,
      included,
      excluded: excludedList,
      contradictory,
      windowDays,
      confidence: conf(
        'No key session in these weeks established the stimulus it was prescribed for.',
        'Weekly volume moves on completed weeks WITH the quality inside them intact.',
      ),
      reason:
        `Weekly volume stays at ${miText(before)}. The weekly totals were met, but no key `
        + 'session in those weeks was completed as prescribed, so there is nothing that '
        + 'establishes the quality inside the volume. That is missing evidence, not a bad week.',
      whatWouldChangeIt: [
        'One key session completed as prescribed, which would establish the criterion.',
      ],
    });
  }

  if (shortLongRuns.length > 0) {
    return holdBecause(
      `Weekly volume stays at ${miText(before)}. The weekly totals were met, but a `
      + 'relevant long run was not substantially completed.',
      ['A long run completed at or near its prescribed distance.'],
      'Weekly volume is supported, long-run completion is not.',
    );
  }

  if (pattern.repeated) {
    return holdBecause(
      `Weekly volume stays at ${miText(before)}. `
      + `${pattern.deterioratedCount} recent sessions fell away in their final phase, `
      + 'which is what more volume would make harder rather than easier.',
      ['Sessions that hold their effort through the final third.'],
      'Repeated late-session deterioration in the window.',
    );
  }

  /* ── The clause that makes this a coach and not a ratchet ──────────────── */

  // Rule 11 · a week the plan has not authored yet is not a week prescribed at
  // zero, and every sentence below is built from `miText(nextWeekPrescribedMi)`,
  // which renders 0 as "no distance". On the real replay five decision points
  // sat between one block ending on race day and the next being authored, so
  // the plan genuinely prescribed nothing ahead. There is no week for a
  // proposal to raise, and saying so is the honest output.
  if (!(input.nextWeekPrescribedMi > 0)) {
    return nonMoving({
      lever: LEVER,
      decision: 'REFUSE',
      beforeValue: before,
      included,
      excluded: excludedList,
      contradictory,
      windowDays,
      confidence: conf(
        'No volume is prescribed for the week a proposal would affect.',
        'The next block has not been authored, so there is no week to raise.',
      ),
      reason:
        `Weekly volume stays at ${miText(before)}. The plan prescribes nothing for the week `
        + 'a proposal would affect, so there is no week to move.',
      whatWouldChangeIt: ['The next block being authored, which gives the proposal a week to reach.'],
    });
  }

  const planAlreadyProgresses =
    input.nextWeekPrescribedMi >= before * (1 + VOLUME_MAX_STEP_FRAC);
  if (planAlreadyProgresses) {
    return holdBecause(
      `Weekly volume stays at ${miText(before)}. The training you have completed `
      + `supports more, and next week already steps up to ${miText(input.nextWeekPrescribedMi)}, `
      + 'so the plan is already providing that progression.',
      ['The evidence is recorded. The lever is available once the planned step has been absorbed.'],
      `Three completed weeks support an increase, and the plan already contains one.`,
    );
  }

  /* ── PROGRESS ──────────────────────────────────────────────────────────── */

  const cap = input.nextWeekPrescribedMi * VOLUME_MAX_STEP_FRAC;
  const after = roundTo(input.nextWeekPrescribedMi + cap);

  return {
    lever: LEVER,
    decision: 'PROGRESS',
    beforeValue: input.nextWeekPrescribedMi,
    proposedAfterValue: after,
    magnitude: {
      unit: 'weekly_mi',
      value: roundTo(cap),
      limit: roundTo(cap),
      limitConstant: 'VOLUME_MAX_STEP_FRAC',
      limitCitation: `${CONTRACT_DOC} · Weekly volume · "≤~5% above the affected prescribed week"`,
    },
    included,
    excluded: excludedList,
    contradictory,
    windowDays,
    confidence: conf(
      `This is supported by ${VOLUME_MIN_CONSECUTIVE_WEEKS} consecutive completed non-cutback weeks.`,
    ),
    reason:
      `Next week goes from ${miText(input.nextWeekPrescribedMi)} to ${miText(after)}. `
      + `The last ${VOLUME_MIN_CONSECUTIVE_WEEKS} non-cutback weeks were completed at `
      + `${Math.round(VOLUME_WEEK_COMPLETION_MIN_FRAC * 100)}% or better with the key sessions intact, `
      + 'and nothing in them fell away late.',
    whatWouldChangeIt: [
      'A week completed below the prescribed volume, which would hold the level.',
      'Repeated late-session deterioration, which would hold it.',
    ],
  };
}
