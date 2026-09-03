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
 * fires on absent data. The asymmetry that produced five downgrades and zero
 * upgrades is not reproduced here.
 *
 * ── RULE 22 · WHAT THIS LEVER'S GATE CANNOT FAIL ON ────────────────────────
 *
 * It cannot fail on a prescribed week that was itself too small. Completion is
 * measured against what was prescribed, so a runner who hits 95% of an
 * under-prescribed week looks identical to one who hits 95% of a correct week.
 * Whether the baseline is aggressive enough is the plan generator's question
 * and this lever cannot see it.
 */
import {
  VOLUME_MIN_CONSECUTIVE_WEEKS,
  VOLUME_WEEK_COMPLETION_MIN_FRAC,
  VOLUME_MAX_STEP_FRAC,
  VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE,
  CONTRACT_DOC,
} from '../contract-constants';
import type { GradedSession, LongRunObservation, WeekObservation } from '../input';
import { GRADES_THAT_COUNT_AS_EVIDENCE } from '../stimulus';
import { assessDeterioration, deteriorationPattern } from '../deterioration';
import { LONG_RUN_COMPLETION_MIN_FRAC } from '../contract-constants';
import type {
  ContradictoryEvidence,
  ExcludedEvidence,
  IncludedEvidence,
  Magnitude,
} from '../decision-record';
import { confidenceFrom, miText, nonMoving, type LeverVerdict } from './shared';
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

  const nonCutback: WeekObservation[] = [];
  for (const w of [...input.weeks].reverse()) {
    if (w.isCutback) {
      excludedList.push({
        activityId: `week:${w.weekStartISO}`,
        dateISO: w.weekStartISO,
        reason: 'PRESCRIBED_RECOVERY_OR_TAPER',
        detail:
          'An authored cutback week. The contract counts consecutive '
          + 'NON-cutback weeks, and a week the plan told him to reduce is not a '
          + 'week he fell short of.',
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
    if (c.frac >= VOLUME_WEEK_COMPLETION_MIN_FRAC) included.push(entry);
    else {
      contradictory.push({
        activityId: entry.activityId,
        dateISO: entry.dateISO,
        detail: `Week completed at ${Math.round(c.frac * 100)}%, below the ${Math.round(VOLUME_WEEK_COMPLETION_MIN_FRAC * 100)}% bar.`,
      });
    }
  }

  const allWeeksMet = completions.every((c) => c.frac >= VOLUME_WEEK_COMPLETION_MIN_FRAC);

  /* ── Key sessions · FULL or defensible SUBSTANTIAL ─────────────────────── */

  const badKeySessions = input.keySessions.filter(
    (s) => !GRADES_THAT_COUNT_AS_EVIDENCE.has(s.grade) && s.grade !== 'INSUFFICIENT',
  );
  for (const s of badKeySessions) {
    contradictory.push({
      activityId: s.provenance.activityId,
      dateISO: s.provenance.dateISO,
      detail: `A key session graded ${s.grade}.`,
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
  const truncatedLongRuns = input.longRuns.filter((l) => l.provenance.truncation.truncated);
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

  const shortLongRuns = input.longRuns.filter(
    (l) => !l.provenance.truncation.truncated
      && l.completedMi.ok && l.prescribedMi > 0
      && l.completedMi.value / l.prescribedMi < LONG_RUN_COMPLETION_MIN_FRAC,
  );
  for (const l of shortLongRuns) {
    contradictory.push({
      activityId: l.provenance.activityId,
      dateISO: l.provenance.dateISO,
      detail: 'A relevant long run was not substantially completed.',
    });
  }

  /* ── No repeated late deterioration ────────────────────────────────────── */

  const pattern = deteriorationPattern([
    ...input.keySessions.map((s) => assessDeterioration(s.thirds, s.provenance.truncation)),
    ...input.longRuns.map((l) => assessDeterioration(l.thirds, l.provenance.truncation)),
  ]);

  /* ── REGRESS · the same bar, pointing the other way ────────────────────── */

  const allWeeksMissed = completions.every((c) => c.frac < VOLUME_WEEK_COMPLETION_MIN_FRAC);
  if (allWeeksMissed) {
    const mean = completions.reduce((a, c) => a + c.frac, 0) / completions.length;
    const proposed = roundTo(before * mean);
    const cap = before * VOLUME_MAX_STEP_FRAC;
    const bounded = Math.max(proposed, roundTo(before - cap));
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
        + 'so the prescribed level is running ahead of what is being absorbed.',
      whatWouldChangeIt: [
        'A completed week at the prescribed volume, which would hold the current level.',
      ],
    };
  }

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

  if (!allWeeksMet) {
    const missed = completions.filter((c) => c.frac < VOLUME_WEEK_COMPLETION_MIN_FRAC).length;
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
      + `${badKeySessions.length} key session did not achieve its intended stimulus.`,
      ['Key sessions in the next block graded FULL or SUBSTANTIAL.'],
      'The volume was there. The quality inside it is not yet established.',
    );
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

  if (input.stepsTakenThisCycle >= VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE) {
    return holdBecause(
      `Weekly volume stays at ${miText(before)}. It has already stepped up once in `
      + 'this cycle, and the contract allows one increase per cutback cycle.',
      ['The next cutback boundary, after which the lever is available again.'],
      'The evidence supports more. The cycle does not.',
    );
  }

  /* ── The clause that makes this a coach and not a ratchet ──────────────── */

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
