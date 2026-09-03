/**
 * lib/adaptation/canonical/levers/long-run.ts · LONG-RUN DISTANCE.
 *
 * `docs/ADAPTATION_ENGINE_CONTRACT.md` "Per-lever evidence contracts ·
 * Long-run distance" (Q22).
 *
 * ── THE RULE THIS LEVER EXISTS TO NOT BREAK ────────────────────────────────
 *
 *     "Faster threshold work must never independently authorize a longer long
 *      run."
 *
 * Enforced by construction, not by a check: `LongRunInput` has no threshold
 * pace field, no capacity belief for pace, and no access to the threshold
 * lever's verdict. It could not read a faster threshold if it wanted to.
 * `_forbidden_inputs.test.ts` asserts the absence, because a future refactor
 * that "helpfully" passes the whole belief object in would silently undo the
 * guarantee.
 *
 * ── RULE 8'S COROLLARY, AND THE ONE READER THAT MUST STAY UNFILTERED ───────
 *
 * `Research/00a`'s spike rule (">110% of the longest run in the prior 30 days")
 * writes its own window into the citation, so `longestInPrior30DaysMi` is the
 * LITERAL recent maximum and is deliberately NOT filtered for taper or
 * post-race weeks.
 *
 * CLAUDE.md Rule 8's corollary is explicit about why, and it is the opposite of
 * what the rest of this engine does: "Filter a reader that asks what the runner
 * CAN DO. Do not filter one that asks what the runner HAS RECENTLY ABSORBED."
 * What the connective tissue will experience next week is a function of what it
 * actually did, not of what this runner normally does. Filtering here would
 * make an injury guard MORE permissive in exactly the situation it exists for.
 *
 * The habit half of the same question is `currentLongRunMi`, the carried
 * belief, which IS the filtered one. Two names, two quantities, per Rule 16.
 *
 * ── RULE 22 · WHAT THIS LEVER'S GATE CANNOT FAIL ON ────────────────────────
 *
 * It cannot fail on a long run that was long but useless. Distance completed is
 * the criterion the contract names, so a 20-mile shuffle at two minutes per
 * mile slower than prescribed passes the completion bar. `followingKeySessionOk`
 * is the only signal that would catch it and it arrives from outside.
 *
 * It cannot fail on a long run matched to the wrong prescription. The pairing
 * of a completed run to the week that asked for it happens upstream, and on the
 * real replay two long runs slipped their prescribed date by up to six days and
 * were matched by week. A run graded against a neighbouring week's number would
 * be graded confidently and wrongly, and nothing in this file could tell.
 */
import {
  LONG_RUN_LOOKBACK_COUNT,
  LONG_RUN_COMPLETION_MIN_FRAC,
  LONG_RUN_MAX_STEP_MI,
  LONG_RUN_MAX_STEPS_PER_CUTBACK_CYCLE,
  CONTRACT_DOC,
} from '../contract-constants';
import type { LongRunObservation } from '../input';
import { qualifiesAsLongRunEvidence, excluded } from '../admissibility';
import { assessDeterioration } from '../deterioration';
import type {
  ContradictoryEvidence,
  ExcludedEvidence,
  IncludedEvidence,
  Magnitude,
} from '../decision-record';
import { confidenceFrom, miText, nonMoving, type LeverVerdict } from './shared';
import { roundTo } from '@/lib/format/run';

/**
 * `Research/00a` · a single run above 110% of the longest run in the prior 30
 * days carries a 64% injury risk. The doctrine's number, named rather than
 * inlined, and read against the LITERAL recent maximum.
 */
export const SPIKE_CEILING_FRAC_OF_PRIOR_30D_MAX = 1.10;

export interface LongRunInput {
  readonly todayISO: string;
  /** The carried belief about long-run distance. The habit reader. */
  readonly currentLongRunMi: number;
  /** Most recent LAST. */
  readonly longRuns: readonly LongRunObservation[];
  /** The long run a proposal would affect. */
  readonly nextLongRunMi: number;
  /**
   * Rule 8 corollary · the LITERAL prior-30-day maximum, unfiltered for taper
   * or recovery. An absorbed-load reader, not a habit reader.
   */
  readonly longestInPrior30DaysMi: number;
  /** Q22 · coherence with weekly volume, resolved by the caller. */
  readonly coherentWithWeeklyVolume: boolean;
  /** Q22 · enough weeks remain for the increase to serve the build. */
  readonly weeksRemainingInBuild: number;
  /** Q22 · collision with a race, peak specific session, or taper. */
  readonly collidesWithRaceOrTaper: boolean;
  readonly stepsTakenThisCycle: number;
}

const LEVER = 'LONG_RUN' as const;

/**
 * How many weeks an increase needs in front of it to be worth making.
 *
 * Q22 requires "enough weeks remain for the increase to serve the marathon
 * build" without putting a number on it. Three: one to introduce the longer
 * run, one to repeat it, and one for the adaptation to show up in a later
 * session. Below that the increase reaches the taper before it reaches the
 * runner. This engine's resolution of an undefined term, flagged as such.
 */
export const LONG_RUN_MIN_WEEKS_TO_SERVE_BUILD = 3;

export function evaluateLongRun(input: LongRunInput): LeverVerdict {
  const before = input.nextLongRunMi;
  const windowDays = 30;

  const included: IncludedEvidence[] = [];
  const excludedList: ExcludedEvidence[] = [];
  const contradictory: ContradictoryEvidence[] = [];

  const conf = (sentence: string, limitation: string | null = null) =>
    confidenceFrom({
      supportingCount: included.length,
      contradictingCount: contradictory.length,
      windowDays,
      sentence,
      limitation,
    });

  /* ── Rule 11 · a week with no long run is not a long run of zero ────────── */

  // `before` is the plan's `nextWeekLongRunMi`, and it is 0 in any week the
  // plan schedules no long run at all. Every sentence below is built from
  // `miText(before)`, and `miText(0)` renders "no distance", so the runner read
  // "The long run stays at no distance." three different ways on the real
  // replay. That is not a formatting slip: a lever proposing a change to a
  // quantity that does not exist in the affected week has nothing to move, and
  // the honest output is a refusal that says so (Rule 11 · absent is not zero).
  if (!(before > 0)) {
    return nonMoving({
      lever: LEVER,
      decision: 'REFUSE',
      beforeValue: before,
      windowDays,
      confidence: conf(
        'The affected week schedules no long run.',
        'There is no prescribed long run for a proposal to move.',
      ),
      reason:
        'The long run is not evaluated this week. The plan schedules no long run in '
        + 'the week a proposal would affect, so there is nothing to move.',
      whatWouldChangeIt: ['The next week whose plan contains a long run.'],
    });
  }

  /* ── The two most recent relevant long runs ────────────────────────────── */

  const recent = [...input.longRuns].slice(-LONG_RUN_LOOKBACK_COUNT);

  if (recent.length < LONG_RUN_LOOKBACK_COUNT) {
    return nonMoving({
      lever: LEVER,
      decision: 'REFUSE',
      beforeValue: before,
      windowDays,
      confidence: conf(
        `Only ${recent.length} recent long run is available.`,
        `The long run moves on the ${LONG_RUN_LOOKBACK_COUNT} most recent prescribed long runs.`,
      ),
      reason:
        `The long run stays at ${miText(before)}. There are only ${recent.length} recent long runs `
        + `to read, and the contract asks for ${LONG_RUN_LOOKBACK_COUNT}.`,
      whatWouldChangeIt: [
        `${LONG_RUN_LOOKBACK_COUNT - recent.length} more completed prescribed long run.`,
      ],
    });
  }

  /* ── Admissibility · truncation is fatal to durability evidence ────────── */

  for (const l of recent) {
    const v = qualifiesAsLongRunEvidence(l);
    if (!v.admissible) {
      excludedList.push(excluded(l.provenance.activityId, l.provenance.dateISO, v));
    }
  }

  if (excludedList.length > 0) {
    return nonMoving({
      lever: LEVER,
      decision: 'REFUSE',
      beforeValue: before,
      excluded: excludedList,
      windowDays,
      confidence: conf(
        `${excludedList.length} of the ${LONG_RUN_LOOKBACK_COUNT} relevant long runs could not be used.`,
        'A long run that was not fully recorded cannot show how it finished.',
      ),
      reason:
        `The long run stays at ${miText(before)}. `
        + `${excludedList.length} of the last ${LONG_RUN_LOOKBACK_COUNT} long runs was not fully recorded, `
        + 'so how it finished is unknown. That is not evidence either way.',
      whatWouldChangeIt: [
        'A fully recorded long run, which would show how the distance was handled late.',
      ],
    });
  }

  /* ── Completion ────────────────────────────────────────────────────────── */

  const completions = recent.map((l) => ({
    l,
    frac: l.completedMi.ok && l.prescribedMi > 0 ? l.completedMi.value / l.prescribedMi : 0,
  }));

  for (const c of completions) {
    const entry: IncludedEvidence = {
      activityId: c.l.provenance.activityId,
      dateISO: c.l.provenance.dateISO,
      what: `${miText(c.l.completedMi.ok ? c.l.completedMi.value : 0)} of ${miText(c.l.prescribedMi)} prescribed, ${Math.round(c.frac * 100)}%`,
      grade: null,
      weight: 1,
    };
    if (c.frac >= LONG_RUN_COMPLETION_MIN_FRAC) included.push(entry);
    else {
      contradictory.push({
        activityId: entry.activityId,
        dateISO: entry.dateISO,
        detail: `Completed at ${Math.round(c.frac * 100)}%, below the ${Math.round(LONG_RUN_COMPLETION_MIN_FRAC * 100)}% bar.`,
      });
    }
  }

  const bothCompleted = completions.every((c) => c.frac >= LONG_RUN_COMPLETION_MIN_FRAC);

  /* ── Deterioration across BOTH ─────────────────────────────────────────── */

  const dets = recent.map((l) => assessDeterioration(l.thirds, l.provenance.truncation));
  const anyDeteriorated = dets.some((d) => d.verdict === 'DETERIORATED');
  const anyUnknown = dets.some((d) => d.verdict === 'UNKNOWN');
  dets.forEach((d, i) => {
    if (d.verdict === 'DETERIORATED') {
      contradictory.push({
        activityId: recent[i].provenance.activityId,
        dateISO: recent[i].provenance.dateISO,
        detail: d.detail,
      });
    }
  });

  /* ── HOLD and REFUSE helpers ───────────────────────────────────────────── */

  const hold = (reason: string, missing: string[], sentence: string) =>
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

  /* ── The cadence bound · ABOVE both branches ───────────────────────────── */

  // Q22 gives this lever "one increase per cutback cycle", and this check used
  // to sit below the REGRESS branch's early return, so the bound governed only
  // the upward path. Replayed against the owner's real history that produced 5
  // long-run REGRESS records and 0 PROGRESS, with the same short long runs
  // re-spent at successive boundaries.
  //
  // Rule 21 asks for the bar up to be placed beside the bar down and any
  // asymmetry justified. There is no citation for one: Q22 defines an increase
  // bound and defines no REGRESS at all, because the REGRESS is this engine's
  // own construction under its own stated rule, "the same bar, the other way".
  // The cadence bound travels with it, so both directions are now one line.
  if (input.stepsTakenThisCycle >= LONG_RUN_MAX_STEPS_PER_CUTBACK_CYCLE) {
    return hold(
      `The long run stays at ${miText(before)}. It has already moved once in this `
      + 'cycle, and the contract allows one step per cutback cycle.',
      ['The next cutback boundary, after which the lever is available again.'],
      'The evidence supports a change. The cycle does not.',
    );
  }

  /* ── REGRESS · the same bar, the other way ─────────────────────────────── */

  const bothMissed = completions.every((c) => c.frac < LONG_RUN_COMPLETION_MIN_FRAC);
  if (bothMissed) {
    const meanCompleted = completions.reduce(
      (a, c) => a + (c.l.completedMi.ok ? c.l.completedMi.value : 0), 0,
    ) / completions.length;

    // ── THE CLAMP THAT WAS MISSING, AND THE DEFECT IT PRODUCED ────────────
    //
    // `Math.max` bounds the proposal from BELOW, so a regression can never
    // fall more than a mile. It said nothing about the top, and the real
    // replay walked straight through the gap on 2026-07-27:
    //
    //     decision   REGRESS
    //     magnitude  +1.5 long_run_mi   (limit 1, LONG_RUN_MAX_STEP_MI)
    //     reason     "The long run eases from 12 mi to 13.5 mi."
    //
    // Three defects in one record: an upward move labelled REGRESS, a
    // magnitude half a mile past the cap the record itself names, and a coach
    // sentence contradicting its own number (Rule 16).
    //
    // The arithmetic that produced it is worth naming, because clamping alone
    // would have hidden it rather than answered it. `bothMissed` is measured
    // against each long run's OWN PRESCRIPTION, and the value it moves is
    // `nextLongRunMi`. Those are two different quantities, and on that date
    // they pointed opposite ways: he ran 18.0 mi and 9.09 mi against
    // prescriptions of 17 and 19, so both "missed", while the mean he actually
    // completed (13.5 mi) sat well ABOVE the 12 mi the next week prescribes.
    //
    // A runner whose demonstrated long runs already meet or exceed the
    // distance a proposal would affect has not shown that distance is too much
    // for him. He has shown that a LARGER prescription was. So the level is
    // held, and the sentence says which of the two facts it is reading. Rule 11
    // applies in its usual form: missing a bigger prescription and being unable
    // to cover this one are opposite facts, and the old code spent them as one.
    if (roundTo(meanCompleted) >= before) {
      return nonMoving({
        lever: LEVER,
        decision: 'HOLD',
        beforeValue: before,
        included,
        excluded: excludedList,
        contradictory,
        windowDays,
        confidence: conf(
          `Both recent long runs came in short of their prescribed distance, and both `
          + `still averaged ${miText(roundTo(meanCompleted))}.`,
          'The prescriptions that were missed were longer than the distance this week asks for.',
        ),
        reason:
          `The long run stays at ${miText(before)}. Both recent long runs came in short of `
          + `what was prescribed, but they averaged ${miText(roundTo(meanCompleted))}, which is `
          + `already at or beyond ${miText(before)}. What was missed was a longer prescription, `
          + 'not this distance.',
        whatWouldChangeIt: [
          `A long run completed at ${LONG_RUN_COMPLETION_MIN_FRAC * 100}% or better, which would `
          + 'let the distance move rather than hold.',
          `A long run that comes in below ${miText(before)}, which would ease the level.`,
        ],
      });
    }

    const proposed = Math.min(
      before,
      Math.max(
        roundTo(meanCompleted),
        roundTo(before - LONG_RUN_MAX_STEP_MI),
      ),
    );
    return {
      lever: LEVER,
      decision: 'REGRESS',
      beforeValue: before,
      proposedAfterValue: proposed,
      magnitude: {
        unit: 'long_run_mi',
        value: roundTo(proposed - before),
        limit: LONG_RUN_MAX_STEP_MI,
        limitConstant: 'LONG_RUN_MAX_STEP_MI',
        limitCitation: `${CONTRACT_DOC} · Long-run distance · "≤~1 mile ordinary"`,
      },
      included,
      excluded: excludedList,
      contradictory,
      windowDays,
      confidence: conf(`Both recent long runs came in short of their prescribed distance.`),
      reason:
        `The long run eases from ${miText(before)} to ${miText(proposed)}. `
        + 'Both recent long runs came in short of the prescribed distance, so the '
        + 'prescription is running ahead of what is being completed.',
      whatWouldChangeIt: [
        'A long run completed at its prescribed distance, which would hold the level.',
      ],
    };
  }

  /* ── HOLD and REFUSE paths ─────────────────────────────────────────────── */

  if (!bothCompleted) {
    return hold(
      `The long run stays at ${miText(before)}. One of the last ${LONG_RUN_LOOKBACK_COUNT} `
      + `came in below ${Math.round(LONG_RUN_COMPLETION_MIN_FRAC * 100)}% of its prescribed distance.`,
      [`${LONG_RUN_LOOKBACK_COUNT} consecutive long runs completed at ${Math.round(LONG_RUN_COMPLETION_MIN_FRAC * 100)}% or better.`],
      `${included.length} of ${LONG_RUN_LOOKBACK_COUNT} recent long runs met the completion bar.`,
    );
  }

  if (anyDeteriorated) {
    return hold(
      `The long run stays at ${miText(before)}. The distance was completed, but the `
      + 'effort fell away in the final third, which is what another mile would test hardest.',
      ['A long run that holds its effort through the final third.'],
      'Both long runs were completed. One did not hold together late.',
    );
  }

  if (anyUnknown) {
    return hold(
      `The long run stays at ${miText(before)}. The distance was completed, but how `
      + 'the final third went could not be read, so durability is not established.',
      ['A long run with complete pace and heart-rate data through the finish.'],
      'Completion is established. How the runs finished is not.',
    );
  }

  // Q22 · the following key session, and Rule 11 applied to it.
  const followUps = recent.map((l) => l.followingKeySessionOk);
  const unreadableFollowUp = followUps.some((f) => !f.ok);
  const failedFollowUp = followUps.some((f) => f.ok && f.value === false);

  if (failedFollowUp) {
    return hold(
      `The long run stays at ${miText(before)}. A key session after one of these long `
      + 'runs did not go to plan, which is the signal that the current distance is '
      + 'already taking what it costs.',
      ['A key session completed normally in the days after a long run.'],
      'Long runs completed. The work after them did not hold up.',
    );
  }

  if (unreadableFollowUp) {
    return nonMoving({
      lever: LEVER,
      decision: 'REFUSE',
      beforeValue: before,
      included,
      excluded: excludedList,
      contradictory,
      windowDays,
      confidence: conf(
        'No key session has followed one of these long runs yet.',
        'Whether the long runs were absorbed is not yet observable.',
      ),
      reason:
        `The long run stays at ${miText(before)}. No key session has followed one of `
        + 'these long runs yet, so whether they were absorbed cannot be judged.',
      whatWouldChangeIt: ['The next key session after a long run being completed and recorded.'],
    });
  }

  if (!input.coherentWithWeeklyVolume) {
    return hold(
      `The long run stays at ${miText(before)}. A longer long run would not sit `
      + 'coherently inside the current weekly volume.',
      ['Weekly volume advancing far enough to carry a longer long run.'],
      'Long-run evidence supports more. The surrounding week does not.',
    );
  }

  if (input.collidesWithRaceOrTaper) {
    return hold(
      `The long run stays at ${miText(before)}. The affected week carries a race or `
      + 'sits inside the taper, where a longer long run has no job to do.',
      ['The next build week that is clear of a race and the taper.'],
      'The evidence supports more. The calendar does not.',
    );
  }

  if (input.weeksRemainingInBuild < LONG_RUN_MIN_WEEKS_TO_SERVE_BUILD) {
    return hold(
      `The long run stays at ${miText(before)}. Only ${input.weeksRemainingInBuild} weeks remain `
      + 'in the build, which is not enough for a longer long run to be absorbed and pay off.',
      ['Nothing in this block. The evidence is recorded for the next one.'],
      'The evidence supports more. There is not enough runway left to spend it.',
    );
  }

  /* ── The spike rule · an injury guard, read literally ──────────────────── */

  const spikeCeiling = input.longestInPrior30DaysMi * SPIKE_CEILING_FRAC_OF_PRIOR_30D_MAX;
  const wanted = before + LONG_RUN_MAX_STEP_MI;
  const after = roundTo(Math.min(wanted, spikeCeiling));

  if (after <= before) {
    return hold(
      `The long run stays at ${miText(before)}. Going further would put it more than `
      + `${Math.round((SPIKE_CEILING_FRAC_OF_PRIOR_30D_MAX - 1) * 100)}% above the longest run of the last 30 days, `
      + `which was ${miText(input.longestInPrior30DaysMi)}.`,
      [`A longer run inside the next 30 days, which raises the ceiling this rule reads.`],
      'The completion evidence supports more. The recent load does not carry it yet.',
    );
  }

  /* ── PROGRESS ──────────────────────────────────────────────────────────── */

  const capped = after < wanted;

  return {
    lever: LEVER,
    decision: 'PROGRESS',
    beforeValue: before,
    proposedAfterValue: after,
    magnitude: {
      unit: 'long_run_mi',
      value: roundTo(after - before),
      limit: LONG_RUN_MAX_STEP_MI,
      limitConstant: capped
        ? 'SPIKE_CEILING_FRAC_OF_PRIOR_30D_MAX'
        : 'LONG_RUN_MAX_STEP_MI',
      limitCitation: capped
        ? 'Research/00a · a run above 110% of the prior 30-day longest carries a 64% injury risk'
        : `${CONTRACT_DOC} · Long-run distance · "≤~1 mile ordinary"`,
    },
    included,
    excluded: excludedList,
    contradictory,
    windowDays,
    confidence: conf(
      `This is supported by ${LONG_RUN_LOOKBACK_COUNT} completed long runs that held together to the finish.`,
      capped
        ? 'The step is held below one mile by the recent-load ceiling.'
        : null,
    ),
    reason:
      `The long run goes from ${miText(before)} to ${miText(after)}. `
      + `The last ${LONG_RUN_LOOKBACK_COUNT} were completed at `
      + `${Math.round(LONG_RUN_COMPLETION_MIN_FRAC * 100)}% or better, both held their effort to the finish, `
      + 'and the key sessions after them went to plan.',
    whatWouldChangeIt: [
      'A long run that falls away late, which would hold the distance here.',
      'A key session after a long run that does not go to plan.',
    ],
  };
}
