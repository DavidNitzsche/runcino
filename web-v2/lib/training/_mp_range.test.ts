/**
 * MPRANGE-1 · a marathon-pace target states the band it is actually known to.
 *
 * `resolvePrescribedPaceAnchors.marathonRangeSecPerMi` (2026-09-02) is the
 * honest span around marathon pace — population exponent to the runner's own
 * raw fit, capped by a demonstrated rehearsal pace — and its own doc comment
 * sets the contract: "every consumer that can show a band shows this one."
 *
 * Before this, an MP prescription reached the runner as one of two wrong
 * widths:
 *
 *   · a long run's `@ M` finish printed a bare POINT (`7:55 /mi`), claiming a
 *     precision a fitted-exponent carry to 26.2 miles does not have;
 *   · a taper's `@ MP` tempo block printed the GRADER's threshold tolerance
 *     (`7:47-8:03`, ±8), which is a statement about how the session will be
 *     judged, not about how well the pace is known.
 *
 * `Research/01` §"Pace zone width and lock-in rules" gives M its own row —
 * "±5 sec/mi | Yes for race-simulation; window for general MP segments" —
 * which is why neither of the two above is the right answer by accident.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 *   · Whether the RANGE is correct. `prescription-resolver.ts` owns it; this
 *     checks that a resolved band survives authoring, expansion and rendering
 *     without being replaced by a tolerance or flattened to a point.
 *   · The WATCH's grading width. `tolerancePaceSPerMi` is deliberately
 *     untouched — that belongs to `execution-semantics.ts`, and re-banding the
 *     wrist's grading from the prescription layer is not this layer's call.
 *   · A row authored with no anchors. Those carry no band and keep exactly the
 *     string they had, which is why the legacy assertions below matter.
 */
import { describe, it, expect } from 'vitest';
import { buildWorkoutSpec } from '@/lib/plan/spec-builder';
import { expandSpecToPhases } from './expand-spec';
import { cardFromSpec, fmtPaceRange } from './spec-card';
import type { PrescribedPaceAnchors } from './prescription-resolver';

/** The owner's live numbers, 2026-09-01: T 430, MP 475, easy ceiling 502. */
const ANCHORS = {
  thresholdSecPerMi: 430,
  intervalSecPerMi: 407,
  repetitionSecPerMi: 371,
  easyCeilingSecPerMi: 502,
  shakeoutCeilingSecPerMi: 532,
  marathonSecPerMi: 475,
  marathonRangeSecPerMi: [469, 481] as const,
  basis: {} as PrescribedPaceAnchors['basis'],
} as unknown as PrescribedPaceAnchors;

const NO_RANGE = { ...(ANCHORS as object), marathonRangeSecPerMi: undefined } as unknown as PrescribedPaceAnchors;

describe('MPRANGE-1 · the marathon band survives to the runner', () => {
  it('formats an asymmetric band from its own two edges', () => {
    expect(fmtPaceRange([469, 481])).toBe('7:49-8:01 /mi');
    // A band tighter than a second per mile is honestly one number.
    expect(fmtPaceRange([475, 475])).toBe('7:55 /mi');
    expect(fmtPaceRange(null)).toBeNull();
  });

  it('an @ MP tempo block carries the band, not the grader s tolerance', () => {
    const built = buildWorkoutSpec(
      'tempo', 15, 430, 168, '2.5 mi WU · 11 mi @ MP · 1.5 mi CD',
      null, null, null, null, false, null, ANCHORS,
    );
    const spec = built.spec as Record<string, unknown>;
    expect(spec.tempo_pace_s_per_mi).toBe(475);
    expect(spec.marathon_range_s_per_mi).toEqual([469, 481]);

    const card = cardFromSpec({ spec: built.spec, type: 'tempo', distanceMi: 15,
      easyPaceSec: 522, easyCeilingSec: 502, hr: null })!;
    const work = card.steps.find((s) => /@ MP/.test(s.label))!;
    expect(work.pace_target).toBe('7:49-8:01 /mi');
    // NOT the threshold tolerance the quality branch would have printed.
    expect(work.pace_target).not.toBe('7:47-8:03 /mi');
  });

  it('a threshold tempo is untouched · its band IS the grader s width', () => {
    const built = buildWorkoutSpec(
      'tempo', 9, 430, 168, '2 mi WU · 5 mi @ T · 2 mi CD',
      null, null, null, null, false, null, ANCHORS,
    );
    expect((built.spec as Record<string, unknown>).marathon_range_s_per_mi).toBeUndefined();
    const card = cardFromSpec({ spec: built.spec, type: 'tempo', distanceMi: 9,
      easyPaceSec: 522, easyCeilingSec: 502, hr: null })!;
    const work = card.steps.find((s) => /tempo/i.test(s.label))!;
    expect(work.pace_target).toBe('7:02-7:18 /mi');
  });

  it('a long run s M finish carries it · an HM finish does not', () => {
    const m = buildWorkoutSpec('long', 16, 430, 168, 'LONG · 4mi @ M',
      null, null, null, null, false, null, ANCHORS).spec as Record<string, unknown>;
    expect(m.finish_range_s_per_mi).toEqual([469, 481]);
    const hm = buildWorkoutSpec('long', 16, 430, 168, 'LONG · 4mi @ HM',
      null, null, null, null, false, null, ANCHORS).spec as Record<string, unknown>;
    expect(hm.finish_range_s_per_mi).toBeUndefined();

    const phases = expandSpecToPhases({ spec: m as never, totalMi: 16,
      easyPaceSec: 522, easyCeilingSec: 502 })!;
    const finish = phases.find((p) => p.isFinishSegment === true)!;
    expect(finish.paceRangeSPerMi).toEqual([469, 481]);
    // The GRADING width is untouched — that is execution-semantics' number.
    expect(finish.tolerancePaceSPerMi).toBe(12);
  });

  it('a progression long bands only its M blocks, per segment', () => {
    const spec = buildWorkoutSpec('long', 20, 430, 168,
      'LONG · 3.5mi @ M + 1mi @ E + 2mi @ T',
      null, null, null, null, false, null, ANCHORS).spec as Record<string, unknown>;
    const segs = spec.finish_segments as Array<Record<string, unknown>>;
    const byTag = Object.fromEntries(segs.map((s) => [String(s.label), s]));
    expect(byTag.M.range_s_per_mi).toEqual([469, 481]);
    expect(byTag.T.range_s_per_mi).toBeUndefined();
  });

  it('no anchors, no band · a legacy row keeps the string it had', () => {
    const built = buildWorkoutSpec(
      'tempo', 15, 430, 168, '2.5 mi WU · 11 mi @ MP · 1.5 mi CD',
      null, null, null, null, false, null, NO_RANGE,
    );
    expect((built.spec as Record<string, unknown>).marathon_range_s_per_mi).toBeUndefined();
    const card = cardFromSpec({ spec: built.spec, type: 'tempo', distanceMi: 15,
      easyPaceSec: 522, easyCeilingSec: 502, hr: null })!;
    expect(card.steps.find((s) => /@ MP/.test(s.label))!.pace_target).toBe('7:47-8:03 /mi');
  });
});
