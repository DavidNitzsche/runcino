/**
 * coach.adjustForReality · TodayCard wiring guard.
 *
 * The TodayCard on /overview and /training reads the result of
 * `coach.adjustForReality` and folds the deltas into the rendered
 * prescription. This test pins the contract the UI relies on:
 *
 *   1. When NO recovery signals fire, the engine returns
 *      `changed: false` with `adjustedFor: []`. The TodayCard renders
 *      unchanged, no fake COACH ADJUSTED pin.
 *   2. When recovery signals fire (gap + check-in + ACWR), the engine
 *      returns `changed: true` with a non-empty `adjustedFor` array
 *      so the TodayCard can render the pin + the "WHY" line.
 *
 * If this test breaks, the TodayCard's adjusted-rendering path is
 * showing the wrong thing.
 */

import { describe, expect, it } from 'vitest';
import { coach } from '../../coach/coach';
import type { WorkoutPrescription } from '../../coach/coach';

const TODAY = '2026-05-12';

/** Minimal scheduled workout the engine can fold over. Mirrors the
 *  shape `prescribeWorkout` returns; only the fields adjustForReality
 *  touches matter. */
function makeScheduled(opts: { isQuality: boolean }): WorkoutPrescription {
  return {
    type: opts.isQuality ? 'threshold' : 'general_aerobic',
    label: opts.isQuality ? 'Threshold 6×800m' : 'Easy 6 mi',
    distanceMi: 6,
    paceTargetSPerMi: null,
    hrZone: opts.isQuality ? 4 : 2,
    phaseLabel: 'BUILD',
    voiceLead: '',
    isQuality: opts.isQuality,
    isLong: false,
    coachToday: {} as WorkoutPrescription['coachToday'],
  };
}

describe('coach.adjustForReality · no signals fire', () => {
  it('returns changed=false with empty adjustedFor when signals are clean', async () => {
    const out = await coach.adjustForReality({
      today: TODAY,
      scheduledWorkout: makeScheduled({ isQuality: false }),
      signals: {
        daysSinceLastRun: 1,
        missedRunsLast7d: 0,
        acwr: 1.0,
      },
    });
    expect(out.answer.changed, 'no signals firing → no plan change').toBe(false);
    expect(
      out.answer.adjustedFor,
      'no signals → empty reasons array so the TodayCard renders the standard pin',
    ).toEqual([]);
    expect(out.answer.workout.label, 'workout passes through unchanged').toBe('Easy 6 mi');
  });
});

describe('coach.adjustForReality · multiple signals fire', () => {
  it('returns changed=true with at least one adjustedFor reason when 2+ signals fire on a quality day', async () => {
    const out = await coach.adjustForReality({
      today: TODAY,
      scheduledWorkout: makeScheduled({ isQuality: true }),
      signals: {
        daysSinceLastRun: 3,
        missedRunsLast7d: 3, // ≥3 missed runs fires
        acwr: 1.6, // >1.5 fires too
      },
    });
    expect(
      out.answer.changed,
      'two recovery signals firing on a quality day → defer quality (Research/00b §Decision Matrix)',
    ).toBe(true);
    expect(
      out.answer.adjustedFor.length,
      'adjustedFor must list at least one reason so the WHY line has copy',
    ).toBeGreaterThan(0);
  });
});

describe('coach.adjustForReality · check-in escalation', () => {
  it('counts 2+ poor check-in days as a qualitative signal', async () => {
    // ACWR clean, no missed runs, but 2 poor check-in days = doctrine
    // qualitative signal. The engine adds it to the count, but a single
    // signal alone is below the defer threshold, so the workout still
    // holds. The signal still appears in the citation path.
    const out = await coach.adjustForReality({
      today: TODAY,
      scheduledWorkout: makeScheduled({ isQuality: true }),
      signals: {
        daysSinceLastRun: 1,
        missedRunsLast7d: 0,
        acwr: 1.6, // first signal
        checkinPoorDaysLast7d: 2, // second signal, doctrine count threshold
      },
    });
    // Two signals firing on a quality day → defer.
    expect(out.answer.changed).toBe(true);
    expect(
      out.answer.adjustedFor.some((r) => /check-in/i.test(r)),
      'check-in poor-days reason must surface in adjustedFor',
    ).toBe(true);
  });
});
