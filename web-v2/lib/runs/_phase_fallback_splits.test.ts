/**
 * lib/runs/_phase_fallback_splits.test.ts · ROUTING-1 (2026-09-09).
 *
 * Fail-before / pass-after for the post-run routing defect traced this
 * session: David's real 5-mile-easy-plus-6-strides run, `runs.id
 * -218380344929823`, read read-only from `faff_readonly` on 2026-09-09.
 *
 * `data.phases` below is the run's OWN raw phase array, trimmed to the fields
 * `phaseFallbackSplits` reads — every `type`, `isStrideSegment`,
 * `actualDistanceMi`, `actualPaceSPerMi` and `avgHr` value is copied verbatim
 * from the queried row, not invented (Rule 13: a display fix is verified
 * against real production shape, and that discipline extends to the fixture
 * that proves the fix). The row's `fetched_at` (14:17:04) sits nineteen
 * minutes before its own `data.ingestedAt` (14:36:46) — proof this exact row
 * existed, mid-write, with `phases` but not yet `splits`.
 *
 * FAIL-BEFORE: before `phaseFallbackSplits` existed, `resolveSplits` on a
 * canonical row with no `splits` array and no twins returned null — asserted
 * directly below via `pickSplits` alone, which is the whole of what
 * `resolveSplits` used to call. `routeSplits` would then be `[]` and the
 * phone's `hasMiles` false, routing an outdoor easy-plus-strides run into the
 * treadmill-only section lane (see `TodayAfterV5.breakdownPieces`'s own
 * ROUTING-1 comment).
 *
 * PASS-AFTER: `resolveSplits`, handed the same canonical figures plus the raw
 * `phases`, now returns ONE honest row sized off the 5.0-mile work phase's own
 * measured distance and pace — non-null, `hasMiles` true, the correct
 * `.milesAndSections` lane.
 */
import { describe, it, expect } from 'vitest';
import { pickSplits, phaseFallbackSplits } from '@/lib/runs/splits-pick';
import { resolveSplits, type CanonicalFigures } from '@/lib/runs/twins';

/** Verbatim from `runs.id = -218380344929823`, `data.phases`, trimmed to the
 *  fields this module reads. Queried read-only, 2026-09-09. */
const REAL_PHASES = [
  { type: 'work', index: 0, actualDistanceMi: 5.01, actualPaceSPerMi: 521, actualDurationSec: 2607, avgHr: 133, label: '5.0 mi easy', completed: true },
  { type: 'work', index: 1, isStrideSegment: true, actualDistanceMi: 0.05, actualPaceSPerMi: 399, actualDurationSec: 20, avgHr: 135, label: 'Stride 1 of 6', completed: true },
  { type: 'recovery', index: 2, actualDistanceMi: 0.04, actualPaceSPerMi: 763, actualDurationSec: 30, avgHr: 144, label: 'Walk back', completed: false },
  { type: 'work', index: 3, isStrideSegment: true, actualDistanceMi: 0.05, actualPaceSPerMi: 412, actualDurationSec: 22, avgHr: 137, label: 'Stride 2 of 6', completed: true },
  { type: 'recovery', index: 4, actualDistanceMi: 0.05, actualPaceSPerMi: 829, actualDurationSec: 43, avgHr: 141, label: 'Walk back', completed: false },
  { type: 'work', index: 5, isStrideSegment: true, actualDistanceMi: 0.05, actualPaceSPerMi: 403, actualDurationSec: 21, avgHr: 126, label: 'Stride 3 of 6', completed: true },
  { type: 'recovery', index: 6, actualDistanceMi: 0.06, actualPaceSPerMi: 1004, actualDurationSec: 61, avgHr: 135, label: 'Walk back', completed: true },
  { type: 'work', index: 7, isStrideSegment: true, actualDistanceMi: 0.05, actualPaceSPerMi: 405, actualDurationSec: 20, avgHr: 109, label: 'Stride 4 of 6', completed: true },
  { type: 'recovery', index: 8, actualDistanceMi: 0.03, actualPaceSPerMi: 733, actualDurationSec: 24, avgHr: 132, label: 'Walk back', completed: false },
  { type: 'work', index: 9, isStrideSegment: true, actualDistanceMi: 0.05, actualPaceSPerMi: 465, actualDurationSec: 22, avgHr: 131, label: 'Stride 5 of 6', completed: true },
  { type: 'recovery', index: 10, actualDistanceMi: 0.06, actualPaceSPerMi: 675, actualDurationSec: 38, avgHr: 144, label: 'Walk back', completed: false },
  { type: 'work', index: 11, isStrideSegment: true, actualDistanceMi: 0.05, actualPaceSPerMi: 456, actualDurationSec: 21, avgHr: 135, label: 'Stride 6 of 6', completed: true },
  { type: 'recovery', index: 12, actualDistanceMi: 0.03, actualPaceSPerMi: 305, actualDurationSec: 8, avgHr: 139, label: 'Walk back', completed: false },
  { type: 'overtime', index: 13, actualDistanceMi: 0.01, actualDurationSec: 10, label: 'After the session', completed: true },
];

/** The canonical row's own figures FOR THE TRANSIENT WINDOW this reproduces —
 *  `distanceMi` present (the completion payload always carries a total), but
 *  `splits` absent, because the mile-cut array had not landed on this row yet. */
const CANONICAL_MID_WRITE: CanonicalFigures = {
  elevGainFt: null,
  elevGainSource: null,
  source: 'watch',
  splits: null,
  distanceMi: 5.58,
};

describe('ROUTING-1 · the mid-write window (phases, no splits yet)', () => {
  it('FAIL-BEFORE: pickSplits alone — the whole of resolveSplits before this fix — returns null', () => {
    // This is exactly what `resolveSplits` did before `phaseFallbackSplits`
    // existed: ask `pickSplits` and stop. With no split array anywhere, it
    // has nothing to choose from.
    const picked = pickSplits(CANONICAL_MID_WRITE.distanceMi, [
      { splits: CANONICAL_MID_WRITE.splits, source: 'canonical' },
    ]);
    expect(picked).toBeNull();
  });

  it('phaseFallbackSplits derives one honest row from the 5.0 mi work phase alone', () => {
    const fallback = phaseFallbackSplits(REAL_PHASES);
    expect(fallback).not.toBeNull();
    expect(fallback).toHaveLength(1);
    expect(fallback![0]).toMatchObject({
      mile: 1,
      pace: '8:41', // 521 s/mi
      hr: 133,
      distanceMi: 5.01,
    });
  });

  it('PASS-AFTER: resolveSplits, given the phases, returns a non-null choice — hasMiles would be true', () => {
    const choice = resolveSplits(CANONICAL_MID_WRITE, [], REAL_PHASES);
    expect(choice).not.toBeNull();
    expect(choice!.splits).toHaveLength(1);
    expect(choice!.splits[0].distanceMi).toBeCloseTo(5.01);
    // Never claims mile-cut coverage from an averaged whole-phase row.
    expect(choice!.coversRun).toBe(false);
  });

  it('never fires on a session built from more than one work block (a tempo, not a steady run)', () => {
    const tempoPhases = [
      { type: 'warmup', actualDistanceMi: 1.5, actualPaceSPerMi: 570 },
      { type: 'work', actualDistanceMi: 3.0, actualPaceSPerMi: 420 },
      { type: 'work', actualDistanceMi: 3.0, actualPaceSPerMi: 425 },
      { type: 'cooldown', actualDistanceMi: 1.0, actualPaceSPerMi: 580 },
    ];
    expect(phaseFallbackSplits(tempoPhases)).toBeNull();
  });

  it('never fires on a session that is nothing but strides (no continuous body to size a row off)', () => {
    const strideOnly = REAL_PHASES.filter((p) => p.type !== 'work' || p.isStrideSegment);
    expect(phaseFallbackSplits(strideOnly)).toBeNull();
  });

  it('refuses when the one work phase itself carries no usable distance or pace', () => {
    expect(phaseFallbackSplits([{ type: 'work', actualDistanceMi: null, actualPaceSPerMi: null }])).toBeNull();
    expect(phaseFallbackSplits([{ type: 'work', actualDistanceMi: 5, actualPaceSPerMi: 0 }])).toBeNull();
  });

  it('does not run when a real split source already exists — the fallback never outranks a real reading', () => {
    const withRealSplits: CanonicalFigures = { ...CANONICAL_MID_WRITE, splits: [{ mile: 1, pace: '8:54' }] };
    const choice = resolveSplits(withRealSplits, [], REAL_PHASES);
    expect(choice).not.toBeNull();
    expect(choice!.source).toBe('canonical');
    expect(choice!.splits).toHaveLength(1);
    expect(choice!.splits[0]).toMatchObject({ mile: 1, pace: '8:54' });
  });
});
