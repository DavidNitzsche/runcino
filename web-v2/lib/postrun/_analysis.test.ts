/**
 * lib/postrun/_analysis.test.ts · the chart stack's claims, made falsifiable.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · IT IS NOT A RENDER. It asserts the series is right, never that a chart
 *     draws it, and Rule 13 is explicit that only a render settles that. The
 *     one defect class this file is structurally blind to is the one that has
 *     cost the most here: a correct payload nothing puts on screen.
 *   · IT CANNOT SEE A MISLEADING CHART. A series can be arithmetically perfect
 *     and still draw a shape that tells the runner the wrong story — an axis
 *     that exaggerates, a colour that grades. No assertion here reaches that.
 *   · IT HAS NO TREADMILL, RACE OR INJURY CASE against real rows. Fixtures
 *     only; `_detail_live.audit.test.ts` carries the production half.
 *   · IT DOES NOT CHECK THE BUCKET COUNT IS *RIGHT*. 140 is a judgement about
 *     phone pixels, not a fact, and nothing here would notice if it were wrong.
 */
import { describe, it, expect } from 'vitest';
import { composePostRunAnalysis, type PostRunAnalysisInput } from './analysis';
import type { GradedPhase } from '@/lib/execution/verdict';

/* ═══════════════════════════════ fixtures ═══════════════════════════════ */

function graded(o: Partial<GradedPhase> & { index: number }): GradedPhase {
  return {
    index: o.index,
    type: o.type ?? 'work',
    label: o.label ?? null,
    shape: o.shape ?? 'window',
    targetSecPerMi: o.targetSecPerMi ?? null,
    toleranceSec: o.toleranceSec ?? null,
    avgSecPerMi: o.avgSecPerMi ?? null,
    actualDurationSec: o.actualDurationSec ?? null,
    actualDistanceMi: o.actualDistanceMi ?? null,
    targetDurationSec: null,
    targetDistanceMi: null,
    avgHr: o.avgHr ?? null,
    maxHr: null,
    avgCadence: null,
    completed: true,
    isFinishSegment: false,
    isStrideSegment: o.isStrideSegment ?? false,
    verdict: 'not_graded',
    statusLabel: null,
    storedVerdict: null,
    timeInToleranceSec: null,
    timeOutOfToleranceSec: null,
  } as GradedPhase;
}

/** `n` samples evenly spaced across `mi`, at a constant pace and heart rate. */
function samples(n: number, mi: number, pace: number | null, bpm: number | null) {
  const paceSamples: unknown[] = [];
  const hrSamples: unknown[] = [];
  for (let i = 1; i <= n; i++) {
    const tSec = i * 5;
    paceSamples.push({ tSec, distMi: (mi * i) / n, paceSPerMi: pace });
    hrSamples.push(bpm == null ? { tSec } : { tSec, bpm });
  }
  return { paceSamples, hrSamples };
}

/* A warm-up, two one-mile reps with a jog between, and a cool-down. */
function repSession(): PostRunAnalysisInput {
  const rawPhases = [
    { ...samples(40, 2.0, 520, 140) },
    { ...samples(20, 1.0, 422, 158) },
    { ...samples(4, 0.12, 515, 158) },
    { ...samples(20, 1.0, 429, 161) },
    { ...samples(40, 2.0, 534, 153) },
  ];
  const gradedPhases = [
    graded({ index: 0, type: 'warmup', label: 'Warm-up', shape: 'ceiling', targetSecPerMi: 502, toleranceSec: 30, actualDistanceMi: 2.0 }),
    graded({ index: 1, type: 'work', label: 'Interval · 1 mi', shape: 'window', targetSecPerMi: 430, toleranceSec: 8, actualDistanceMi: 1.0 }),
    graded({ index: 2, type: 'recovery', label: 'Jog 1 min', shape: 'none', actualDistanceMi: 0.12 }),
    graded({ index: 3, type: 'work', label: 'Interval · 1 mi', shape: 'window', targetSecPerMi: 430, toleranceSec: 8, actualDistanceMi: 1.0 }),
    graded({ index: 4, type: 'cooldown', label: 'Cool-down', shape: 'ceiling', targetSecPerMi: 502, toleranceSec: 30, actualDistanceMi: 2.0 }),
  ];
  return { rawPhases, gradedPhases, rawSplits: null, totalDistanceMi: 6.12 };
}

/* ═════════════════════════ the shared x-axis ════════════════════════════ */

describe('the shared axis · PR-11 is structural, not a promise', () => {
  it('places the phase bands where the phases actually are', () => {
    const a = composePostRunAnalysis(repSession())!;
    expect(a.grain).toBe('SAMPLED');
    expect(a.bands.map((b) => [b.fromMi, b.toMi])).toEqual([
      [0, 2], [2, 3], [3, 3.12], [3.12, 4.12], [4.12, 6.12],
    ]);
  });

  it('walks the offset by the PHASE length, not by its last sample', () => {
    /* A stride's samples stop a beat before the stride does — four readings
     * reach 0.036 of a 0.05 mile piece on the owner's 2026-09-02 row. Letting
     * the axis inherit that shortfall drags every later phase backwards, and
     * the drift compounds across thirteen phases.
     *
     * FALSIFIER: change `offsetMi += graded[i]?.actualDistanceMi ?? lastMi` to
     * `offsetMi += lastMi` and the last point falls short of the last band. */
    const input = repSession();
    // Samples that under-report every phase by 20 percent.
    input.rawPhases = (input.rawPhases as any[]).map((p, i) => ({
      ...samples(10, (input.gradedPhases[i].actualDistanceMi ?? 1) * 0.8, 500, 150),
    }));
    const a = composePostRunAnalysis(input)!;
    // The bands still span the real 6.12 miles...
    expect(a.bands[a.bands.length - 1].toMi).toBe(6.12);
    // ...and the samples reach the last phase rather than stopping in the third.
    const last = a.points[a.points.length - 1].atMi;
    expect(last).toBeGreaterThan(a.bands[a.bands.length - 1].fromMi);
  });

  it('REGRESSION · the axis is the UNION of the layers, not the samples alone', () => {
    /* The owner's 2026-08-23 run: 11.01 miles, of which the watch recorded ONE
     * phase covering 5.00, and twelve split rows covering the lot. The axis
     * used to be the samples' 4.98 — so the mile ticks read 1 to 4 under a
     * heading saying "the shape of the run", and the elevation layer, which
     * has readings for the whole distance, was cropped to its first five.
     *
     * Found by rendering. Three layers, two spans, on a component whose whole
     * premise is that they share one.
     *
     * FALSIFIER: drop the elevation term from the `spanMi` maximum and the
     * elevation series runs off the end of the axis again. */
    const a = composePostRunAnalysis({
      rawPhases: [{ ...samples(60, 5.0, 515, 140) }],
      gradedPhases: [graded({ index: 0, type: 'work', actualDistanceMi: 5.0 })],
      rawSplits: Array.from({ length: 11 }, (_, i) => ({
        mile: i + 1, pace: '8:40', hr: 140, elev_ft: i % 2 === 0 ? 12 : -8,
      })),
      totalDistanceMi: 11.01,
    })!;
    const lastElev = a.elevation![a.elevation!.length - 1].atMi;
    const lastPoint = a.points[a.points.length - 1].atMi;
    // The axis reaches the elevation layer's end, not the samples'.
    expect(lastPoint).toBeGreaterThan(10);
    expect(lastPoint).toBeGreaterThanOrEqual(lastElev - a.bucketMi);
    // And past the samples the pace layer is a GAP, not a continuation.
    const beyond = a.points.filter((p) => p.atMi > 6);
    expect(beyond.length).toBeGreaterThan(10);
    expect(beyond.every((p) => p.paceSecPerMi === null)).toBe(true);
    // Which the spoken summary says out loud rather than leaving to the eye.
    expect(a.accessibilitySummary).toMatch(/recorded nothing/);
  });

  it('spans what the phases cover, not the run total · the overtime is prose', () => {
    /* On 2026-09-02 the phases account for 5.98 of a 6.41 mile run. Stretching
     * the axis to 6.41 draws four tenths of empty chart that reads as a sensor
     * dropout; the difference is `PostRunCapture`'s sentence and is already
     * said above the numbers (Rule 17). */
    const input = repSession();
    input.totalDistanceMi = 9.0;
    const a = composePostRunAnalysis(input)!;
    expect(a.points[a.points.length - 1].atMi).toBeLessThan(6.2);
  });
});

/* ═══════════════════════════ honest gaps ════════════════════════════════ */

describe('gaps are gaps · Rule 11', () => {
  it('a sample with no bpm produces NULL, never zero and never a fill', () => {
    /* The 2026-09-01 warm-up opens with five samples carrying no `bpm` at all.
     * A zero heart rate drawn as a line to the floor is the lie the brief's
     * "marked rather than interpolated as truth" forbids. */
    const input = repSession();
    (input.rawPhases as any[])[0] = { ...samples(40, 2.0, 520, null) };
    const a = composePostRunAnalysis(input)!;
    const early = a.points.filter((p) => p.atMi < 1.9);
    expect(early.length).toBeGreaterThan(5);
    expect(early.every((p) => p.hrBpm === null)).toBe(true);
    expect(early.some((p) => p.hrBpm === 0)).toBe(false);
    // The pace layer beside it is untouched. The two are independent.
    expect(early.every((p) => p.paceSecPerMi !== null)).toBe(true);
    expect(a.hasHr).toBe(true); // later phases still have it
  });

  it('names the gap count out loud in the spoken summary', () => {
    const input = repSession();
    input.rawPhases = (input.rawPhases as any[]).map(() => ({ paceSamples: [], hrSamples: [] }));
    input.rawSplits = [
      { mile: 1, pace: '8:40', hr: 140 },
      { mile: 2, pace: '8:40' },
      { mile: 3, pace: '7:02', hr: 158 },
    ];
    const a = composePostRunAnalysis(input)!;
    expect(a.grain).toBe('PER_MILE');
    expect(a.points[1].hrBpm).toBeNull();
  });

  it('a heart rate outside what a human produces is not a heart rate', () => {
    const input = repSession();
    (input.rawPhases as any[])[1] = { ...samples(20, 1.0, 422, 900) };
    const a = composePostRunAnalysis(input)!;
    const inRep = a.points.filter((p) => p.atMi > 2.05 && p.atMi < 2.95);
    expect(inRep.every((p) => p.hrBpm === null)).toBe(true);
  });
});

/* ══════════════════════════ pace provenance ═════════════════════════════ */

describe('the pace layer is the wrist reading, never a division', () => {
  it('reports the recorded pace even when distance and time disagree with it', () => {
    /* The samples below cover a mile in 100 seconds, which no runner did. The
     * series must still report the 422 the watch recorded, because that is the
     * number the runner saw and the number the phase grading used. A module
     * that derived pace from distance over time would print 100.
     *
     * FALSIFIER: add a `distMi/tSec` fallback ahead of `paceSPerMi`. */
    const input = repSession();
    (input.rawPhases as any[])[1] = {
      paceSamples: Array.from({ length: 20 }, (_, i) => ({
        tSec: (i + 1) * 5, distMi: ((i + 1) / 20), paceSPerMi: 422,
      })),
      hrSamples: [],
    };
    const a = composePostRunAnalysis(input)!;
    const inRep = a.points.filter((p) => p.atMi > 2.1 && p.atMi < 2.9);
    expect(inRep.length).toBeGreaterThan(0);
    expect(inRep.every((p) => p.paceSecPerMi === 422)).toBe(true);
  });

  it('a sample with no pace is a gap, not a subtraction', () => {
    const input = repSession();
    (input.rawPhases as any[])[1] = { ...samples(20, 1.0, null, 158) };
    const a = composePostRunAnalysis(input)!;
    const inRep = a.points.filter((p) => p.atMi > 2.1 && p.atMi < 2.9);
    expect(inRep.every((p) => p.paceSecPerMi === null)).toBe(true);
    expect(inRep.every((p) => p.hrBpm === 158)).toBe(true);
  });
});

/* ════════════════════════════ the overlay ═══════════════════════════════ */

describe('the target overlay covers only the phases it applies to', () => {
  it('carries a target on the graded phases and NOT on the jog', () => {
    const a = composePostRunAnalysis(repSession())!;
    expect(a.bands[1].targetSecPerMi).toBe(430);
    expect(a.bands[1].toleranceSec).toBe(8);
    // The recovery has `shape: 'none'` and takes no line. A target ruled
    // across it would mark every jog a miss, which is the whole-run-average
    // failure drawn instead of written.
    expect(a.bands[2].targetSecPerMi).toBeNull();
  });

  it('NEVER puts a target on a stride', () => {
    /* Doctrine calls a stride "not a workout". On 2026-09-02 four of six were
     * graded as deviations for being quick, and a chart that drew a target
     * line over them would say the same thing in pictures. */
    const input = repSession();
    input.gradedPhases[1] = graded({
      index: 1, type: 'work', label: 'Stride 1 of 6', shape: 'effort',
      targetSecPerMi: 401, isStrideSegment: true, actualDistanceMi: 1.0,
    });
    const a = composePostRunAnalysis(input)!;
    expect(a.bands[1].isStride).toBe(true);
    expect(a.bands[1].targetSecPerMi).toBeNull();
  });

  it('draws NO bands for a single-phase recording', () => {
    /* One band spanning everything is indistinguishable from the whole-run
     * average this surface exists to avoid. */
    const a = composePostRunAnalysis({
      rawPhases: [{ ...samples(60, 6.0, 515, 137) }],
      gradedPhases: [graded({ index: 0, type: 'work', actualDistanceMi: 6.0 })],
      rawSplits: null,
      totalDistanceMi: 6.0,
    })!;
    expect(a.bands).toEqual([]);
    expect(a.hasPace).toBe(true);
  });
});

/* ═════════════════════════════ elevation ════════════════════════════════ */

describe('elevation · PR-10 degrades honestly', () => {
  it('is NULL when no split recorded a change', () => {
    /* Eleven of the owner's last fourteen runs record `hr, mile, pace` and
     * nothing else. A flat line over those is a measurement we do not have
     * printed as one we do — rule one at chart scale. */
    const input = repSession();
    input.rawSplits = [{ mile: 1, pace: '8:40', hr: 140 }, { mile: 2, pace: '8:40', hr: 145 }];
    expect(composePostRunAnalysis(input)!.elevation).toBeNull();
  });

  it('cumulates signed deltas from zero when the splits carry them', () => {
    const input = repSession();
    input.rawSplits = [
      { mile: 1, pace: '8:40', elev_ft: 40 },
      { mile: 2, pace: '8:40', elev_ft: -25 },
      { mile: 3, pace: '8:40', elev_ft: 10 },
    ];
    const e = composePostRunAnalysis(input)!.elevation!;
    // Starts at zero: it is a shape, not an altitude. Nothing in this app
    // stores an altitude and the caption says so.
    expect(e[0]).toEqual({ atMi: 0, ft: 0 });
    expect(e.map((p) => p.ft)).toEqual([0, 40, 15, 25]);
  });
});

/* ══════════════════════════════ refusal ═════════════════════════════════ */

describe('composePostRunAnalysis refuses rather than drawing nothing', () => {
  it('returns NULL when there is no series at all', () => {
    /* Null means the phone draws no chart section. An EMPTY stack would draw a
     * flat run at pace zero, which is why the empty case is not returned. */
    expect(composePostRunAnalysis({
      rawPhases: [], gradedPhases: [], rawSplits: null, totalDistanceMi: 4.0,
    })).toBeNull();
  });

  it('returns NULL when splits exist but carry no readings', () => {
    expect(composePostRunAnalysis({
      rawPhases: [], gradedPhases: [],
      rawSplits: [{ mile: 1 }, { mile: 2 }], totalDistanceMi: 2.0,
    })).toBeNull();
  });

  it('falls back to the mile grain and SAYS which grain it used', () => {
    const a = composePostRunAnalysis({
      rawPhases: [], gradedPhases: [],
      rawSplits: [
        { mile: 1, pace: '8:40', hr: 140 },
        { mile: 2, pace: '8:20', hr: 148 },
        { mile: 3, pace: '7:02', hr: 158 },
      ],
      totalDistanceMi: 3.0,
    })!;
    expect(a.grain).toBe('PER_MILE');
    // One column per row, not 140 columns with 137 holes in them.
    expect(a.points).toHaveLength(3);
    expect(a.accessibilitySummary).toContain('one point per mile');
    expect(a.accessibilitySummary).not.toContain('second by second');
  });

  it('sizes the trailing fragment from the run total', () => {
    /* A 2.4 mile run reporting three unsized rows ends in a 0.4 mile piece, and
     * placing it as a whole mile pushes the axis to three. */
    const a = composePostRunAnalysis({
      rawPhases: [], gradedPhases: [],
      rawSplits: [
        { mile: 1, pace: '8:40' }, { mile: 2, pace: '8:20' }, { mile: 3, pace: '7:02' },
      ],
      totalDistanceMi: 2.4,
    })!;
    // Midpoints: 0.5, 1.5, and 2.2 for a 0.4 mile tail.
    expect(a.points[2].atMi).toBeCloseTo(2.2, 1);
  });
});
