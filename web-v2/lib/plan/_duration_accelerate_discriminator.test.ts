/**
 * lib/plan/_duration_accelerate_discriminator.test.ts · DURATIONOFFER-2
 * (2026-09-12), FOUND BY INDEPENDENT REVIEW.
 *
 * `firstDurationAccelerate`'s first cut filtered on the TRANSLATED
 * `BrainAction`'s `kind === 'DURATION_CHANGE' && direction === 'MORE'`,
 * reasoning that only a genuine ACCELERATE could produce that shape because
 * TAKE always carries `changed: false`. That reasoning used
 * `resolveProgressionStep`'s (`progression-gate.ts`) own `changed` field,
 * but `actionFromProgression` is fed `resolveWeekProgression`'s
 * (`progression-pass.ts`) OWN, independently-recomputed `changed` —
 * `!sameShape(shape, target.current)` — which is deliberately `true` for a
 * TAKE that resumes a previously-held/paused progression (see
 * `progression-pass.ts`'s own "A TAKE that CHANGES the row is the resume
 * case" comment). A resumed TAKE therefore produces the IDENTICAL
 * `{kind:'DURATION_CHANGE', direction:'MORE'}` shape a genuine
 * strong-evidence ACCELERATE does, and the original filter could not tell
 * them apart.
 *
 * This is exactly the case independent review constructed to falsify the
 * claim. Reproduced here as a permanent regression test, alongside a
 * positive control proving a genuine ACCELERATE still gets offered.
 */
import { describe, it, expect } from 'vitest';
import { firstDurationAccelerate } from './action-proposal-lane';
import type { AdaptationAction } from './adapt';
import type { ProgressionResolution } from './progression-pass';
import type { WorkShape } from '@/lib/prescription/levers';

const BASE_SHAPE: WorkShape = { reps: 4, repMinutes: 6, recoveryMinutes: 2, paceSPerMi: 400, zone: 'ESTABLISHED' };

function reshapeAction(resolution: ProgressionResolution): AdaptationAction {
  return {
    kind: 'reshape',
    workoutIds: ['pw_test'],
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

describe('firstDurationAccelerate · the discriminator reads the real verdict, not an inferred one', () => {
  it('REJECTS a resumed TAKE that happens to translate to DURATION_CHANGE/MORE (the falsified case)', () => {
    const resumedTake: ProgressionResolution = {
      workoutId: 'pw_test',
      dateISO: '2026-09-15',
      family: 'interval',
      action: 'TAKE', // the real gate verdict — NOT an ACCELERATE
      shape: { ...BASE_SHAPE, repMinutes: 7 }, // stepped up from where the ladder paused
      authored: { ...BASE_SHAPE, repMinutes: 8 }, // the calendar had already moved further
      authoredLever: 'interval_duration',
      lever: 'interval_duration', // set for TAKE per progression-pass.ts's own branch
      why: 'Picking the progression back up from where it paused rather than from where the calendar had got to.',
      changed: true, // the resume case — recomputed independently of resolveProgressionStep's own field
    };

    const result = firstDurationAccelerate([reshapeAction(resumedTake)]);
    expect(result, 'a resumed TAKE must never be offered as an earned ACCELERATE').toBeNull();
  });

  it('ACCEPTS a genuine strong-evidence ACCELERATE on the interval_duration axis (positive control)', () => {
    const genuineAccelerate: ProgressionResolution = {
      workoutId: 'pw_test',
      dateISO: '2026-09-15',
      family: 'interval',
      action: 'ACCELERATE',
      shape: { ...BASE_SHAPE, repMinutes: 9 },
      authored: { ...BASE_SHAPE, repMinutes: 8 },
      authoredLever: 'interval_duration',
      lever: 'interval_duration',
      why: 'You are absorbing this block well, so this week asks for a little more than the plan had drawn up.',
      changed: true,
    };

    const result = firstDurationAccelerate([reshapeAction(genuineAccelerate)]);
    expect(result, 'a genuine ACCELERATE on interval_duration must still be offered').not.toBeNull();
    expect(result?.action.kind).toBe('DURATION_PROGRESS_OFFER');
    expect(result?.action.direction).toBe('MORE');
  });

  it('REJECTS a BACK_OFF even though reduce() never touches pace (sanity — should never have been ambiguous)', () => {
    const backOff: ProgressionResolution = {
      workoutId: 'pw_test',
      dateISO: '2026-09-15',
      family: 'interval',
      action: 'BACK_OFF',
      shape: { ...BASE_SHAPE, reps: 3 },
      authored: { ...BASE_SHAPE, reps: 4 },
      authoredLever: 'interval_duration',
      lever: null, // BACK_OFF pulls no lever
      why: 'Easing this week rather than adding to it.',
      changed: true,
    };
    const result = firstDurationAccelerate([reshapeAction(backOff)]);
    expect(result).toBeNull();
  });

  it('REJECTS a HOLD', () => {
    const hold: ProgressionResolution = {
      workoutId: 'pw_test',
      dateISO: '2026-09-15',
      family: 'interval',
      action: 'HOLD',
      shape: BASE_SHAPE,
      authored: BASE_SHAPE,
      authoredLever: null,
      lever: null,
      why: 'Holding this week where it was rather than adding to it.',
      changed: false,
    };
    const result = firstDurationAccelerate([reshapeAction(hold)]);
    expect(result).toBeNull();
  });
});
