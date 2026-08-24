/**
 * lib/coach/_phase_breakdown.test.ts — what the watch recorded, reaching the
 * phone intact.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE GAP THIS CLOSES
 *
 * `mapWatchPhases` (formerly the tail of `loadPhaseBreakdown`) has shipped the
 * phone a per-phase target, actual, distance, duration and heart rate since
 * P44. It dropped three fields the device had already computed and stored:
 *
 *   · `verdict`                — the watch's own grade, against the server's
 *                                own tolerance, using a 5-second sample stream
 *                                that never leaves the wrist
 *   · `timeInToleranceSec`     — seconds inside the pace band
 *   · `timeOutOfToleranceSec`  — seconds outside it
 *
 * On 2026-08-23 the runner's work block carried 90 seconds in and 2280 out.
 * No screen in the product said so, because the field stopped at this
 * function.
 *
 * THE FIXTURE IS PRODUCTION. `AUG11_PHASES` is `coach_intents.value.phases`
 * for `dnitch85@me.com`'s 2026-08-11 race-week tune-up, read at
 * `faff_readonly` on 2026-08-24 with the two sample arrays stripped (they are
 * hundreds of points long and this function never looks at them). Nine phases:
 * a warm-up, four 1 km reps, three jogs and a cool-down.
 */
import { describe, it, expect } from 'vitest';
import { mapWatchPhases } from './run-state';

/** Real rows. Nothing here was chosen to make an assertion convenient. */
const AUG11_PHASES = [
  { index: 0, type: 'warmup', label: 'Warm-up', avgHr: 135, maxHr: 155, avgCadence: 159,
    targetPaceSPerMi: 537, actualPaceSPerMi: 475, actualDistanceMi: 1.5, actualDurationSec: 714,
    completed: true, verdict: 'missed', timeInToleranceSec: 25, timeOutOfToleranceSec: 675 },
  { index: 1, type: 'work', label: 'Interval · 1 km', avgHr: 164, maxHr: 169, avgCadence: 174,
    targetPaceSPerMi: 412, actualPaceSPerMi: 381, actualDistanceMi: 0.62, actualDurationSec: 237,
    completed: true, verdict: 'missed', timeInToleranceSec: 15, timeOutOfToleranceSec: 225 },
  { index: 2, type: 'recovery', label: 'Jog 1:30', avgHr: 164, maxHr: 170, avgCadence: 160,
    targetPaceSPerMi: 537, actualPaceSPerMi: 494, actualDistanceMi: 0.18, actualDurationSec: 90,
    completed: true, verdict: 'hit', timeInToleranceSec: 70, timeOutOfToleranceSec: 20 },
  { index: 3, type: 'work', label: 'Interval · 1 km', avgHr: 169, maxHr: 173, avgCadence: 171,
    targetPaceSPerMi: 412, actualPaceSPerMi: 387, actualDistanceMi: 0.62, actualDurationSec: 242,
    completed: true, verdict: 'missed', timeInToleranceSec: 15, timeOutOfToleranceSec: 225 },
  { index: 4, type: 'recovery', label: 'Jog 1:30', avgHr: 127, maxHr: 173, avgCadence: 116,
    targetPaceSPerMi: 537, actualPaceSPerMi: 857, actualDistanceMi: 0.1, actualDurationSec: 90,
    completed: true, verdict: 'missed', timeInToleranceSec: 5, timeOutOfToleranceSec: 85 },
  { index: 5, type: 'work', label: 'Interval · 1 km', avgHr: 168, maxHr: 175, avgCadence: 168,
    targetPaceSPerMi: 412, actualPaceSPerMi: 402, actualDistanceMi: 0.62, actualDurationSec: 250,
    completed: true, verdict: 'drifted', timeInToleranceSec: 155, timeOutOfToleranceSec: 95 },
  { index: 6, type: 'recovery', label: 'Jog 1:30', avgHr: 155, maxHr: 175, avgCadence: 115,
    targetPaceSPerMi: 537, actualPaceSPerMi: 1006, actualDistanceMi: 0.09, actualDurationSec: 90,
    completed: true, verdict: 'missed', timeInToleranceSec: 0, timeOutOfToleranceSec: 90 },
  { index: 7, type: 'work', label: 'Interval · 1 km', avgHr: 160, maxHr: 174, avgCadence: 162,
    targetPaceSPerMi: 412, actualPaceSPerMi: 416, actualDistanceMi: 0.62, actualDurationSec: 259,
    completed: true, verdict: 'drifted', timeInToleranceSec: 170, timeOutOfToleranceSec: 90 },
  { index: 8, type: 'cooldown', label: 'Cool-down', avgHr: 161, maxHr: 174, avgCadence: 154,
    targetPaceSPerMi: 537, actualPaceSPerMi: 505, actualDistanceMi: 1.0, actualDurationSec: 507,
    completed: true, verdict: 'missed', timeInToleranceSec: 15, timeOutOfToleranceSec: 490 },
];

/** 2026-08-23. One work phase, and the sentence the owner asked for. */
const AUG23_PHASES = [
  { index: 0, type: 'work', label: '5.0 mi easy', avgHr: 147, maxHr: 171, avgCadence: 164,
    targetPaceSPerMi: 562, actualPaceSPerMi: 478, actualDistanceMi: 5, actualDurationSec: 2389,
    completed: true, verdict: 'missed', timeInToleranceSec: 90, timeOutOfToleranceSec: 2280 },
];

describe('mapWatchPhases · the watch verdict survives the trip', () => {
  it('carries every phase, in order, with its own grade', () => {
    const out = mapWatchPhases(AUG11_PHASES);
    expect(out).toHaveLength(9);
    expect(out.map((p) => p.verdict)).toEqual([
      'missed', 'missed', 'hit', 'missed', 'missed', 'drifted', 'missed', 'drifted', 'missed',
    ]);
  });

  it('carries both tolerance counters on every phase', () => {
    const out = mapWatchPhases(AUG11_PHASES);
    expect(out.map((p) => p.time_in_tolerance_sec)).toEqual([25, 15, 70, 15, 5, 155, 0, 170, 15]);
    expect(out.map((p) => p.time_out_of_tolerance_sec)).toEqual([675, 225, 20, 225, 85, 95, 90, 90, 490]);
  });

  it('ZERO IS A READING · the jog that spent none of its 90 seconds in band is 0, not null', () => {
    // `Number(null)` is 0 and `Number(undefined)` is NaN, so the naive coerce
    // makes "not recorded" and "none of it" the same answer. Phase six really
    // did score zero; it must not be indistinguishable from a treadmill phase
    // that was never graded at all.
    const out = mapWatchPhases(AUG11_PHASES);
    expect(out[6].time_in_tolerance_sec).toBe(0);
    expect(out[6].time_out_of_tolerance_sec).toBe(90);
  });

  it('ABSENT IS NOT ZERO · a treadmill phase, which records neither, comes back null', () => {
    // `TreadmillView.buildPayload` writes no verdict and no counters. A zero
    // here would claim the console graded the phase and found none of it in
    // band, when it has no pace sensor to grade with.
    const out = mapWatchPhases([
      { index: 0, type: 'work', label: '4 mi tempo', actualPaceSPerMi: 440,
        actualDistanceMi: 4, actualDurationSec: 1760, completed: true },
    ]);
    expect(out[0].verdict).toBeNull();
    expect(out[0].time_in_tolerance_sec).toBeNull();
    expect(out[0].time_out_of_tolerance_sec).toBeNull();
  });

  it('a grade we do not know is dropped, never guessed', () => {
    const out = mapWatchPhases([
      { index: 0, type: 'work', label: 'Rep', targetPaceSPerMi: 412,
        actualPaceSPerMi: 400, completed: true, verdict: 'excellent' },
    ]);
    expect(out[0].verdict).toBeNull();
  });

  it('the SERVER read and the WATCH read both travel, and are allowed to disagree', () => {
    // Phase seven: mean pace 416 against a 412 target is inside the server's
    // heat-adjusted ±10s band, so `status` is 'on'. The device saw the same
    // rep saw either side of the band across its samples and called it
    // 'drifted'. Neither overwrites the other — the second is the one holding
    // the sample stream's evidence, and it had nowhere to go until now.
    const out = mapWatchPhases(AUG11_PHASES);
    expect(out[7].status).toBe('on');
    expect(out[7].verdict).toBe('drifted');
  });
});

describe('mapWatchPhases · the 2026-08-23 work block', () => {
  it('carries 90 seconds in against 2280 out', () => {
    const out = mapWatchPhases(AUG23_PHASES);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe('5.0 mi easy');
    expect(out[0].verdict).toBe('missed');
    expect(out[0].time_in_tolerance_sec).toBe(90);
    expect(out[0].time_out_of_tolerance_sec).toBe(2280);
  });

  it('THE SENTENCE THE PHONE COMPOSES FROM IT · 1:30 of 39:30', () => {
    // `RunDetailV5.toleranceLine` sums the work phases and formats both. This
    // asserts the arithmetic the phone will do, in the one place a test can
    // reach it: in + out is 2370 seconds of GRADED time, which is less than
    // the phase's own 2389-second duration, because the device only counts a
    // second it had a pace for.
    const out = mapWatchPhases(AUG23_PHASES);
    const work = out.filter((p) => p.type === 'work');
    const inSec = work.reduce((s, p) => s + (p.time_in_tolerance_sec ?? 0), 0);
    const outSec = work.reduce((s, p) => s + (p.time_out_of_tolerance_sec ?? 0), 0);
    expect(inSec).toBe(90);
    expect(inSec + outSec).toBe(2370);
    expect(inSec + outSec).toBeLessThan(out[0].actual_duration_sec!);
  });

  it('WORK PHASES ONLY · a long cool-down must not drown the work', () => {
    // The 2026-08-11 cool-down alone carries 490 seconds out of band, more
    // than every rep put together. Rolling warm-up and cool-down into the
    // session's tolerance read would make a well-executed set look ragged
    // because the runner jogged home slowly. `workToleranceShare` in
    // lib/runs/run-shape.ts filters the same way, for the same reason.
    const out = mapWatchPhases(AUG11_PHASES);
    const work = out.filter((p) => p.type === 'work');
    const workIn = work.reduce((s, p) => s + (p.time_in_tolerance_sec ?? 0), 0);
    const workTotal = workIn + work.reduce((s, p) => s + (p.time_out_of_tolerance_sec ?? 0), 0);
    expect(work).toHaveLength(4);
    expect(workIn).toBe(355);       // 5:55
    expect(workTotal).toBe(990);    // 16:30

    const allIn = out.reduce((s, p) => s + (p.time_in_tolerance_sec ?? 0), 0);
    const allTotal = allIn + out.reduce((s, p) => s + (p.time_out_of_tolerance_sec ?? 0), 0);
    expect(allTotal).toBeGreaterThan(workTotal * 2);
  });
});

describe('mapWatchPhases · rule three', () => {
  it('no phases is an empty list, never a row of nulls', () => {
    expect(mapWatchPhases(undefined)).toEqual([]);
    expect(mapWatchPhases(null)).toEqual([]);
    expect(mapWatchPhases([])).toEqual([]);
    expect(mapWatchPhases('not an array')).toEqual([]);
  });
});
