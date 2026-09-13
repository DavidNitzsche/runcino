/**
 * Scratch script (not a test — run once by hand, not part of any suite) to
 * generate the REAL structural strings a DURATION_PROGRESS_OFFER card would
 * carry, by calling the real production functions with representative data,
 * rather than hand-typing strings into an HTML mockup. Prints JSON to stdout.
 */
import { actionHeadline } from '../faff/v5-action-render';
import { firstDurationAccelerate } from './action-proposal-lane';
import type { AdaptationAction } from './adapt';
import type { ProgressionResolution } from './progression-pass';
import type { WorkShape } from '../prescription/levers';
import type { BrainAction } from '../brain/proposal/action';

const BASE_SHAPE: WorkShape = { reps: 4, repMinutes: 6, recoveryMinutes: 2, paceSPerMi: 400, zone: 'ESTABLISHED' };

function reshapeAction(resolution: ProgressionResolution): AdaptationAction {
  return {
    kind: 'reshape',
    workoutIds: ['pw_tue_intervals'],
    why: resolution.why,
    reshape: {
      resolution,
      row: { type: 'intervals', distanceMi: 8, subLabel: null },
      band: 'strong',
      lthr: 168,
      weekStartISO: '2026-09-08',
    },
  } as AdaptationAction;
}

// 1 · Genuine strong-evidence ACCELERATE — representative real shape.
const genuineAccelerate: ProgressionResolution = {
  workoutId: 'pw_tue_intervals',
  dateISO: '2026-09-16',
  family: 'interval',
  action: 'ACCELERATE',
  shape: { ...BASE_SHAPE, repMinutes: 7 },
  authored: { ...BASE_SHAPE, repMinutes: 6 },
  authoredLever: 'interval_duration',
  lever: 'interval_duration',
  why: 'You are absorbing this block well, so this week asks for a little more than the plan had drawn up · reps 6:00 -> 7:00 min.',
  changed: true,
};
const genuineResult = firstDurationAccelerate([reshapeAction(genuineAccelerate)]);

// 2 · Resumed TAKE — the exact shape the independent-review defect exposed.
// Must produce NO card after the DURATIONOFFER-2 fix.
const resumedTake: ProgressionResolution = {
  workoutId: 'pw_tue_intervals',
  dateISO: '2026-09-16',
  family: 'interval',
  action: 'TAKE',
  shape: { ...BASE_SHAPE, repMinutes: 7 },
  authored: { ...BASE_SHAPE, repMinutes: 8 },
  authoredLever: 'interval_duration',
  lever: 'interval_duration',
  why: 'Picking the progression back up from where it paused rather than from where the calendar had got to.',
  changed: true,
};
const resumedResult = firstDurationAccelerate([reshapeAction(resumedTake)]);

// 3 · BACK_OFF and HOLD — sanity, must also produce no card.
const backOff: ProgressionResolution = {
  workoutId: 'pw_tue_intervals', dateISO: '2026-09-16', family: 'interval', action: 'BACK_OFF',
  shape: { ...BASE_SHAPE, reps: 3 }, authored: { ...BASE_SHAPE, reps: 4 },
  authoredLever: 'interval_duration', lever: null,
  why: 'Easing this week rather than adding to it.', changed: true,
};
const backOffResult = firstDurationAccelerate([reshapeAction(backOff)]);

const out = {
  genuineAccelerate: {
    resolutionAction: genuineAccelerate.action,
    offerRaised: genuineResult !== null,
    kind: genuineResult?.action.kind,
    headline: genuineResult ? actionHeadline(genuineResult.action, 'Tuesday') : null,
    reason: genuineResult?.why,
    mutatingSiblingHeadlineForComparison: (() => {
      // What DURATION_CHANGE (the real, mutating kind) would have rendered,
      // for direct visual contrast with the offer's "could go to" wording.
      if (genuineResult === null || genuineResult.action.kind !== 'DURATION_PROGRESS_OFFER') return null;
      const mutating: BrainAction = { ...genuineResult.action, kind: 'DURATION_CHANGE' };
      return actionHeadline(mutating, 'Tuesday');
    })(),
  },
  resumedTake: {
    resolutionAction: resumedTake.action,
    offerRaised: resumedResult !== null,
    note: 'Must be false after DURATIONOFFER-2 — a resumed TAKE is not a strong-evidence ACCELERATE.',
  },
  backOff: {
    resolutionAction: backOff.action,
    offerRaised: backOffResult !== null,
  },
};

// eslint-disable-next-line no-console
console.log(JSON.stringify(out, null, 2));
