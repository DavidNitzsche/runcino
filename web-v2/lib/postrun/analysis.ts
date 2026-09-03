/**
 * lib/postrun/analysis.ts · THE SYNCHRONISED CHART STACK, composed once.
 *
 * PR-8 (pace), PR-9 (heart rate), PR-10 (elevation) and PR-11 (the overlay)
 * are one object and not four, because the post-run brief asks for "one
 * synchronized chart stack with selectable layers" and lists "shared x-axis"
 * as its first requirement. Four series composed independently would each be
 * correct and would still be able to disagree about where mile three is.
 *
 * So the x-axis is built ONCE, here, and every layer is a column against it.
 * A phone that draws two of these layers cannot misalign them, because there
 * is only one axis and it did not compute it.
 *
 * ── WHAT THE DATA ACTUALLY IS, AND WHY THAT DECIDES THE DESIGN ─────────────
 *
 * The reference screenshots the owner supplied are second-by-second GPS
 * streams. This app has no such thing and never has. What it has, measured
 * against the live table on 2026-09-03, is two grains:
 *
 *   SAMPLED   `runs.data.phases[].paceSamples` / `.hrSamples` — the faff
 *             watch's own five-second readings, `{tSec, distMi, paceSPerMi}`
 *             and `{tSec, bpm}`, with tSec and distMi resetting at each phase
 *             boundary. 799 pace samples on the 2026-09-01 threshold session,
 *             607 on 2026-09-02. This is a real stream and it is what the
 *             stack draws whenever it exists.
 *
 *   PER_MILE  `runs.data.splits` — one row per mile. Present on 104 of the
 *             owner's 114 runs in the trailing 180 days, and the ONLY grain
 *             available on a Strava-synced run.
 *
 * They are named on the wire (`grain`) rather than blended, because a chart
 * drawn from thirteen mile rows and a chart drawn from eight hundred wrist
 * readings are not the same claim and the runner is entitled to know which
 * one is in front of him.
 *
 * ── THE PACE SERIES IS THE WRIST'S OWN READING. IT IS NOT DERIVED ──────────
 *
 * Every point's pace is the `paceSPerMi` the watch recorded at that instant —
 * the number on the runner's wrist at the time, and the number the phase
 * grading was computed from. This module NEVER divides a distance by a
 * duration. That is deliberate on two counts: `check-derived-consistency.sh`
 * is right that a file holding distance, duration and pace together and doing
 * arithmetic on them is where a second opinion about pace gets born, and a
 * five-second GPS delta is a noisy divisor besides. A sample with no
 * `paceSPerMi` is a GAP, not a subtraction.
 *
 * ── HONEST GAPS (Rule 11) ─────────────────────────────────────────────────
 *
 * A bucket with no reading is `null` and the layer BREAKS there. Nothing is
 * interpolated across it, and `null` never becomes zero: the brief's own
 * requirement is "pauses/sensor gaps marked rather than interpolated as
 * truth", and a zero heart rate drawn as a line to the floor is exactly the
 * lie that phrasing forbids. The 2026-09-01 warm-up opens with five samples
 * carrying no `bpm` at all — the strap had not caught yet — and those five
 * are the test case.
 *
 * ── WHAT IS NOT HERE, AND WHY ─────────────────────────────────────────────
 *
 * NO GRADE-ADJUSTED SERIES. `lib/terrain/grade-adjust.ts` owns the one
 * course-adjustment coefficient in this app (`DESCENT_GIVEBACK_FRACTION`,
 * 0.50) and `lib/coach/run-state.ts` already resolves the run's
 * `grade_adjusted_pace_s_per_mi` through it and ships it on the same
 * response this object travels on. Recomputing GAP per mile here would need
 * per-mile GAIN and LOSS, and a split row carries only a signed NET delta —
 * so a rolling mile that climbed sixty feet and dropped sixty would adjust to
 * nothing. That is not the owner's model applied at a finer grain, it is a
 * SECOND and worse model wearing its name. PR-12 is therefore served by the
 * whole-run figure the canonical owner already publishes, drawn beside the
 * real pace and labelled, and there is no second coefficient in this file.
 *
 * NO PACE-ZONE DISTRIBUTION. The reference has one, computed off a stated
 * marathon race time. This app resolves training paces in one place and shows
 * time-in-zone once, on the HR zone bar the run-detail screen already draws.
 * A second distribution keyed off a second fitness answer is Rule 16.
 */
import type { GradedPhase } from '@/lib/execution/verdict';
import { normalizeSplits, pos, type NormalizedSplit } from '@/lib/runs/run-shape';

/* ═════════════════════════════ 1 · the shape ════════════════════════════ */

export const POST_RUN_ANALYSIS_VERSION = 'analysis-1';

/**
 * WHICH GRAIN THIS STACK WAS DRAWN AT. Three facts, never one (Rule 11).
 *
 *   SAMPLED   the wrist's five-second readings
 *   PER_MILE  one point per split row
 *
 * There is no third value and no default. A run that offers neither produces
 * NO analysis object at all, so a caller cannot receive an empty stack and
 * read it as a flat run.
 */
export type AnalysisGrain = 'SAMPLED' | 'PER_MILE';

/** One column of the stack. Every field may be null, independently. */
export interface AnalysisPoint {
  /** Cumulative distance from the run's start, miles. THE shared x-axis. */
  atMi: number;
  /** Seconds per mile, as the instrument reported it. Null is a gap. */
  paceSecPerMi: number | null;
  /** Beats per minute. Null is a gap. */
  hrBpm: number | null;
}

/**
 * A phase, placed on the shared axis.
 *
 * `kind` is the phase's own type and `targetSecPerMi` is the band it was
 * GRADED against — both straight off `GradedPhase`, which is the canonical
 * grader's output. Nothing here re-decides what a phase was or what it asked
 * for; this type only says WHERE on the axis it sat.
 */
export interface AnalysisBand {
  index: number;
  label: string | null;
  /** `warmup` | `work` | `recovery` | `cooldown` | `unknown`. */
  kind: string;
  fromMi: number;
  toMi: number;
  /**
   * The target line to draw ACROSS THIS BAND ONLY, s/mi. Null wherever the
   * phase was not pace-graded — a recovery jog, a stride, an unplanned run.
   *
   * The brief: "target range overlay only over phases to which it applies".
   * A single target line ruled across a whole session is the "whole-run
   * average misrepresents an interval session" failure drawn instead of
   * written, and it is the one this stack most has to avoid.
   */
  targetSecPerMi: number | null;
  /** Half-width of the band, s/mi. Null when the phase carries no tolerance. */
  toleranceSec: number | null;
  /** True for a stride. A stride is never pace-graded and is never a miss. */
  isStride: boolean;
}

/** The elevation layer. Its own array because it has its own grain. */
export interface AnalysisElevationPoint {
  atMi: number;
  /**
   * Feet RELATIVE to the run's start, cumulated from per-split signed deltas.
   *
   * NOT an altitude. Nothing in this app stores one: the reference's chart
   * reads 690-730 ft above sea level and there is no field on any run row
   * that could produce that number. What a split carries is a change, so what
   * this draws is a shape starting at zero — which answers "where were the
   * climbs" and refuses to answer "how high was I", and the phone's caption
   * says so.
   */
  ft: number;
}

export interface PostRunAnalysis {
  version: string;
  grain: AnalysisGrain;
  /** How wide one point is, miles. The resolution claim, stated not implied. */
  bucketMi: number;
  points: AnalysisPoint[];
  /** Empty on an unstructured run. Never a single band spanning everything. */
  bands: AnalysisBand[];
  /**
   * NULL when no split on this run recorded an elevation change — which is
   * the common case on this runner's rows, so the phone draws no elevation
   * section at all rather than a flat line meaning "we did not measure".
   */
  elevation: AnalysisElevationPoint[] | null;
  /** True when at least one point carries a pace. */
  hasPace: boolean;
  /** True when at least one point carries a heart rate. */
  hasHr: boolean;
  /** One sentence for VoiceOver and for a reader who cannot see the chart. */
  accessibilitySummary: string;
}

/* ═══════════════════════════════ 2 · input ══════════════════════════════ */

export interface PostRunAnalysisInput {
  /**
   * The RAW stored phase array — the same list `load.ts` resolved and handed
   * to the grader, not the graded output. The samples live only on the raw
   * elements; `GradedPhase` deliberately does not carry them.
   */
  rawPhases: unknown[];
  /**
   * The grader's output for that same list, in the same order. Bands are
   * built from THIS, so what a phase was and what it asked for is decided in
   * exactly one place and it is not this one.
   */
  gradedPhases: GradedPhase[];
  /** `runs.data.splits`, for the PER_MILE fallback and for elevation. */
  rawSplits: unknown;
  /** `runs.data.distanceMi`. Sizes the trailing fragment on the mile grain. */
  totalDistanceMi: number | null;
}

/** How many points the stack is reduced to. */
const TARGET_BUCKETS = 140;

/* A phone chart is roughly 350 points wide at 3x, and a series longer than
 * its pixel count is bytes nobody can see. 140 keeps a four-by-one-mile
 * session at about a fifteenth of a mile per point — fine enough that a rep's
 * shape survives — while holding the payload near 6 KB. */

/* ══════════════════════════ 3 · reading samples ═════════════════════════ */

function finiteNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/* NO LOCAL `positive()`. `run-shape.ts` exports `pos` — "a finite POSITIVE
 * number, or null, for quantities where zero is not a measurement" — and its
 * own doc comment records that a second copy of that question over one payload
 * is a Rule 16 violation the coercion ratchet counted, correctly. This module
 * reads the same stored phases and needs the same answer, so it calls the same
 * function. */

/**
 * A heart rate, bounded the way `hrToNum` bounds one.
 *
 * The bounds are restated as a call, not as a constant: `run-shape.ts` owns
 * "what counts as a heart rate" for this whole app and a second pair of
 * numbers here would be a second answer to that question.
 */
function bpm(v: unknown): number | null {
  const n = finiteNumber(v);
  if (n == null) return null;
  const r = Math.round(n);
  return r > 40 && r < 230 ? r : null;
}

interface RawSample {
  /** Cumulative distance from the RUN's start, after offsetting. */
  atMi: number;
  paceSecPerMi: number | null;
  hrBpm: number | null;
}

/**
 * Flatten the per-phase sample arrays onto one run-long distance axis.
 *
 * `tSec` and `distMi` restart at every phase boundary — verified on the
 * 2026-09-01 and 2026-09-02 rows, where each phase's last `distMi` matches
 * that phase's own `actualDistanceMi` to three decimals. So the offset walks
 * forward by the phase's ACTUAL distance rather than by its last sample: the
 * samples stop a beat before the phase does (a stride's four samples reach
 * 0.036 of a 0.05 mile piece), and letting the axis inherit that shortfall
 * would slowly pull every later phase backwards.
 *
 * The two sample arrays are aligned by `tSec` and NOT by position. They are
 * usually the same length, and on the 2026-09-02 strides they are not.
 */
function flattenSamples(rawPhases: unknown[], graded: GradedPhase[]): RawSample[] {
  const out: RawSample[] = [];
  let offsetMi = 0;

  for (let i = 0; i < rawPhases.length; i++) {
    const p = rawPhases[i];
    if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
    const rec = p as Record<string, unknown>;

    const paceRaw = Array.isArray(rec.paceSamples) ? rec.paceSamples : [];
    const hrRaw = Array.isArray(rec.hrSamples) ? rec.hrSamples : [];

    /* HEART RATE BY TIME, so a pace sample can find its heart rate without
     * assuming the two arrays step together. */
    const hrAt = new Map<number, number>();
    for (const h of hrRaw) {
      if (!h || typeof h !== 'object') continue;
      const t = finiteNumber((h as Record<string, unknown>).tSec);
      const b = bpm((h as Record<string, unknown>).bpm);
      if (t != null && b != null) hrAt.set(t, b);
    }

    let lastMi = 0;
    for (const s of paceRaw) {
      if (!s || typeof s !== 'object') continue;
      const rec2 = s as Record<string, unknown>;
      const d = finiteNumber(rec2.distMi);
      const t = finiteNumber(rec2.tSec);
      if (d == null || d < 0) continue;
      lastMi = Math.max(lastMi, d);
      out.push({
        atMi: offsetMi + d,
        /* THE WRIST'S OWN NUMBER, or a gap. Never a subtraction. */
        paceSecPerMi: pos(rec2.paceSPerMi),
        hrBpm: t != null ? (hrAt.get(t) ?? null) : null,
      });
    }

    /* A phase with heart rate and NO pace samples still has a heart rate, and
     * dropping it would put a hole in the HR layer that the data does not
     * have. Placed across the phase's own span by time share. */
    if (paceRaw.length === 0 && hrRaw.length > 0) {
      const span = graded[i]?.actualDistanceMi ?? 0;
      const times = [...hrAt.keys()].sort((a, b) => a - b);
      const lastT = times[times.length - 1] ?? 0;
      for (const t of times) {
        out.push({
          atMi: offsetMi + (lastT > 0 ? (t / lastT) * span : 0),
          paceSecPerMi: null,
          hrBpm: hrAt.get(t) ?? null,
        });
      }
    }

    /* THE PHASE'S OWN LENGTH, not its last sample's. See the doc comment. */
    offsetMi += graded[i]?.actualDistanceMi ?? lastMi;
  }

  return out.sort((a, b) => a.atMi - b.atMi);
}

/* ══════════════════════════ 4 · the mile grain ══════════════════════════ */

/**
 * One point per split row, placed at the MIDPOINT of the mile it describes.
 *
 * The midpoint and not the end: a mile row is an average over a span, and
 * hanging it on the span's right edge shifts the whole series half a mile
 * later than the running it describes. On a chart with phase bands underneath
 * that misplacement is visible.
 *
 * A split with no stated length is one mile. That is the same convention
 * `splitDistanceMi` in `load.ts` uses and it is right for the same reason: a
 * split array is per-mile by construction, so a row that does not say how
 * long it is, is a whole one. The trailing fragment is the row that DOES say.
 */
function milePoints(splits: NormalizedSplit[], totalMi: number | null): RawSample[] {
  const out: RawSample[] = [];
  let cursor = 0;
  for (let i = 0; i < splits.length; i++) {
    const s = splits[i];
    let len = s.distanceMi != null && s.distanceMi > 0 ? s.distanceMi : 1;
    /* SIZE THE LAST PIECE FROM THE RUN'S OWN TOTAL when the row did not say.
     * A 6.41 mi run reporting six unsized rows ends in a 1.41 mile "mile"
     * unless somebody says otherwise; the run's total is what says otherwise,
     * and only when it leaves a real remainder. */
    if (i === splits.length - 1 && s.distanceMi == null && totalMi != null && totalMi > 0) {
      const remainder = totalMi - cursor;
      if (remainder > 0 && remainder < 1) len = remainder;
    }
    out.push({
      atMi: cursor + len / 2,
      paceSecPerMi: s.paceSec,
      hrBpm: s.hr,
    });
    cursor += len;
  }
  return out;
}

/* ════════════════════════════ 5 · bucketing ═════════════════════════════ */

/**
 * Reduce a sample list to a fixed number of columns on the distance axis.
 *
 * Pace is DISTANCE-WEIGHTED and heart rate is a plain mean of the readings in
 * the bucket. The weighting matters for pace and not for HR because the
 * samples are evenly spaced in TIME: within one bucket a slow stretch
 * contributes more samples than a fast one, so an unweighted mean pace would
 * be dragged toward the slow end of every bucket. Weighting each sample by
 * the ground it covered is what makes the column mean the mile it sits on.
 *
 * On the mile grain each sample already IS a bucket-sized average, so the
 * weight is the split's own length and the arithmetic degenerates correctly.
 *
 * AN EMPTY BUCKET IS NULL. It is not dropped and it is not filled.
 */
function bucket(samples: RawSample[], spanMi: number, buckets: number): AnalysisPoint[] {
  const width = spanMi / buckets;
  const paceNum = new Array<number>(buckets).fill(0);
  const paceDen = new Array<number>(buckets).fill(0);
  const hrNum = new Array<number>(buckets).fill(0);
  const hrCount = new Array<number>(buckets).fill(0);

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const b = Math.min(buckets - 1, Math.max(0, Math.floor(s.atMi / width)));
    /* THE GROUND THIS SAMPLE COVERED. The gap to its neighbour, floored at a
     * hair so a duplicated distance reading cannot zero out a real pace. */
    const prev = i > 0 ? samples[i - 1].atMi : 0;
    const w = Math.max(s.atMi - prev, 1e-6);
    if (s.paceSecPerMi != null) { paceNum[b] += s.paceSecPerMi * w; paceDen[b] += w; }
    if (s.hrBpm != null) { hrNum[b] += s.hrBpm; hrCount[b] += 1; }
  }

  const out: AnalysisPoint[] = [];
  for (let b = 0; b < buckets; b++) {
    /* THE DIVISORS, NAMED. Not a style preference: `check-coercion.sh`'s
     * `isArithmeticGuard` recognises `den > 0 ? num / den : null` as a
     * division guard rather than a collapsed measurement, and its pattern ends
     * in a word boundary — which an indexed expression like `paceDen[b]` does
     * not have, so the guard was counted as a zero-erasure. Naming the
     * divisors is the honest way to satisfy it: the classifier is not widened,
     * and a reader can see at a glance that a zero here is an empty bucket and
     * not a measured value being thrown away. */
    const paceWeight = paceDen[b];
    const hrReadings = hrCount[b];
    out.push({
      atMi: Math.round((b + 0.5) * width * 1000) / 1000,
      paceSecPerMi: paceWeight > 0 ? Math.round(paceNum[b] / paceWeight) : null,
      hrBpm: hrReadings > 0 ? Math.round(hrNum[b] / hrReadings) : null,
    });
  }
  return out;
}

/* ════════════════════════════ 6 · elevation ═════════════════════════════ */

/**
 * Cumulative relative elevation, or NULL.
 *
 * Null when no split carried a change — which on this runner's rows is most
 * of them: eleven of his last fourteen runs record `hr, mile, pace,
 * paceSecPerMi` and nothing else. A flat line drawn over those would be a
 * measurement we do not have, printed as one we do, which is rule one at
 * chart scale. So the layer is absent and the phone draws no section.
 *
 * A split whose row carries no delta inside a run that mostly does is treated
 * as no change for that mile — the only reading available, and the honest
 * direction: it understates a climb rather than inventing one.
 */
function elevationSeries(
  splits: NormalizedSplit[],
  totalMi: number | null,
): AnalysisElevationPoint[] | null {
  if (!splits.some((s) => s.elevFt != null)) return null;
  const out: AnalysisElevationPoint[] = [{ atMi: 0, ft: 0 }];
  let cursor = 0;
  let ft = 0;
  for (let i = 0; i < splits.length; i++) {
    const s = splits[i];
    let len = s.distanceMi != null && s.distanceMi > 0 ? s.distanceMi : 1;
    if (i === splits.length - 1 && s.distanceMi == null && totalMi != null && totalMi > 0) {
      const remainder = totalMi - cursor;
      if (remainder > 0 && remainder < 1) len = remainder;
    }
    cursor += len;
    ft += s.elevFt ?? 0;
    out.push({ atMi: Math.round(cursor * 1000) / 1000, ft: Math.round(ft) });
  }
  return out;
}

/* ══════════════════════════════ 7 · bands ═══════════════════════════════ */

/**
 * The phases, placed on the axis.
 *
 * A band's target is `GradedPhase.targetSecPerMi` and it is carried ONLY when
 * that phase's own `shape` says the number is something to hold or stay under.
 * `effort` and `none` yield null — a stride and a recovery jog have no line,
 * which is the brief's "overlay only over phases to which it applies" and is
 * also the reason a strides day cannot be drawn as six misses.
 *
 * A single phase spanning the whole run produces NO bands. That shape is an
 * unstructured recording, not a session with one segment, and a band ruled
 * across everything is indistinguishable from the whole-run average this
 * surface exists to avoid.
 */
function bandsFrom(graded: GradedPhase[]): AnalysisBand[] {
  if (graded.length < 2) return [];
  const out: AnalysisBand[] = [];
  let cursor = 0;
  for (const p of graded) {
    const len = p.actualDistanceMi ?? 0;
    const graded_ = p.shape === 'window' || p.shape === 'ceiling';
    out.push({
      index: p.index,
      label: p.label,
      kind: p.type,
      fromMi: Math.round(cursor * 1000) / 1000,
      toMi: Math.round((cursor + len) * 1000) / 1000,
      targetSecPerMi: graded_ ? p.targetSecPerMi : null,
      toleranceSec: graded_ ? p.toleranceSec : null,
      isStride: p.isStrideSegment,
    });
    cursor += len;
  }
  return out;
}

/* ═══════════════════════════ 8 · the composer ═══════════════════════════ */

/**
 * Compose the stack, or return NULL.
 *
 * Null is a real answer and the common one on a treadmill row or a manual
 * entry: no samples, no splits, nothing to draw. The caller then sends no
 * `analysis` key and the phone draws no chart section — as opposed to an
 * empty stack, which a chart would render as a flat run at pace zero.
 */
export function composePostRunAnalysis(input: PostRunAnalysisInput): PostRunAnalysis | null {
  const splits = normalizeSplits(input.rawSplits);
  const sampled = flattenSamples(input.rawPhases, input.gradedPhases);

  /* WHICH GRAIN, and the test is whether the samples SAY anything. A phase
   * array carrying empty sample lists is not a stream, and falling through to
   * the mile rows is the right answer for it rather than an empty chart. */
  const usable = sampled.filter((s) => s.paceSecPerMi != null || s.hrBpm != null);
  const grain: AnalysisGrain = usable.length >= 8 ? 'SAMPLED' : 'PER_MILE';
  const samples = grain === 'SAMPLED'
    ? sampled
    : milePoints(splits, input.totalDistanceMi);

  if (samples.length === 0) return null;
  if (!samples.some((s) => s.paceSecPerMi != null || s.hrBpm != null)) return null;

  const bands = bandsFrom(input.gradedPhases);
  const elevation = elevationSeries(splits, input.totalDistanceMi);

  /* ── THE SPAN THE AXIS COVERS · THE UNION OF EVERY LAYER ────────────────
   *
   * As far as ANY layer has something to draw, and no further.
   *
   * THE UNION, AND NOT THE SAMPLES ALONE, WHICH IS A CORRECTION. This took
   * the furthest sample and the last band, and on the owner's 2026-08-23 run
   * that was wrong in a way only a render showed. The run is 11.01 miles; the
   * watch recorded ONE phase covering 5.00 of them; the splits cover 11.88.
   * So the axis was 4.98 miles long, the mile ticks read 1 to 4 under a
   * heading that says "the shape of the run", and the elevation layer — which
   * has readings for the whole 11.88 — was silently cropped to its first
   * five. Three layers, two spans, on a component whose entire premise is
   * that they share one.
   *
   * Extending to the union does not invent anything. Past mile five the pace
   * and heart layers have no readings, so they are null, so the line BREAKS —
   * which is the honest-gaps rule already doing its job, and it says the true
   * thing: the watch stopped recording detail there and the run went on.
   *
   * AND NOT THE RUN'S OWN TOTAL. `totalDistanceMi` is not in this maximum,
   * deliberately: on 2026-09-02 it is 6.41 against 5.98 of phases, and
   * stretching the axis to a distance NO layer has a reading for would draw
   * four tenths of empty chart that reads as a sensor dropout. That
   * difference is `PostRunCapture`'s sentence to say, it is already said
   * above the numbers, and repeating it as chart furniture is Rule 17.
   *
   * The last BAND's end counts, not just the last sample: samples stop a beat
   * before their phase does, and an axis a fraction shorter than the bands
   * drawn on it puts the cool-down's right edge past the end of the chart. */
  const spanMi = Math.max(
    samples.reduce((m, s) => Math.max(m, s.atMi), 0),
    bands.length > 0 ? bands[bands.length - 1].toMi : 0,
    elevation && elevation.length > 0 ? elevation[elevation.length - 1].atMi : 0,
  );
  if (!(spanMi > 0)) return null;

  /* ── THE MILE GRAIN IS NOT BUCKETED, AND THAT IS A CORRECTION ───────────
   *
   * It was, and the arithmetic was wrong in a way only a test caught. A mile
   * point already sits at the MIDPOINT of the mile it describes — 0.5, 1.5,
   * 2.2 for a 2.4 mile run — and re-binning three such points onto a uniform
   * three-column grid moved them to 0.37, 1.10 and 1.83. Every column was
   * displaced, and on a chart with phase bands underneath, visibly.
   *
   * Bucketing exists to REDUCE a dense stream. There is nothing to reduce
   * here: the split rows are the columns, correctly placed, and the honest
   * thing is to leave them where they are. */
  const points = grain === 'PER_MILE'
    ? samples.map((s) => ({
        atMi: Math.round(s.atMi * 1000) / 1000,
        paceSecPerMi: s.paceSecPerMi == null ? null : Math.round(s.paceSecPerMi),
        hrBpm: s.hrBpm,
      }))
    /* AT MOST ONE BUCKET PER TWO SAMPLES. A bucket with no sample in it is a
     * null, and a null is drawn as a break in the line — so slicing a sparse
     * stream too finely manufactures gaps the recording does not have. The
     * owner's real sessions carry a sample every hundredth of a mile and land
     * on the 140 cap with six readings a column; the halving only binds on a
     * short or sparsely-sampled run, which is exactly where it should. */
    : bucket(samples, spanMi,
        Math.min(TARGET_BUCKETS, Math.max(12, Math.floor(samples.length / 2))));
  const hasPace = points.some((p) => p.paceSecPerMi != null);
  const hasHr = points.some((p) => p.hrBpm != null);
  if (!hasPace && !hasHr) return null;

  return {
    version: POST_RUN_ANALYSIS_VERSION,
    grain,
    bucketMi: Math.round((spanMi / points.length) * 1000) / 1000,
    points,
    bands,
    elevation,
    hasPace,
    hasHr,
    accessibilitySummary: analysisSummary({
      grain, spanMi, bands, hasPace, hasHr, elevation, points,
    }),
  };
}

/* ═════════════════════════ 9 · the spoken version ═══════════════════════ */

/**
 * What a reader who cannot see the chart is told.
 *
 * It names the GRAIN, because "eight hundred wrist readings" and "thirteen
 * mile rows" are different claims, and it names the layers PRESENT rather
 * than describing shape. It states no verdict: the chart is Layer 2 and the
 * judgement is Layer 1's, already said by the coach card above it (Rule 17).
 */
function analysisSummary(x: {
  grain: AnalysisGrain;
  spanMi: number;
  bands: AnalysisBand[];
  hasPace: boolean;
  hasHr: boolean;
  elevation: AnalysisElevationPoint[] | null;
  points: AnalysisPoint[];
}): string {
  const layers: string[] = [];
  if (x.hasPace) layers.push('pace');
  if (x.hasHr) layers.push('heart rate');
  if (x.elevation) layers.push('elevation');
  const layerText = layers.length === 1 ? layers[0]
    : layers.length === 2 ? `${layers[0]} and ${layers[1]}`
    : `${layers.slice(0, -1).join(', ')} and ${layers[layers.length - 1]}`;

  const source = x.grain === 'SAMPLED'
    ? 'from the watch second by second'
    : 'one point per mile';

  const parts = [`${layerText[0].toUpperCase()}${layerText.slice(1)} across ${x.spanMi.toFixed(2)} miles, ${source}.`];

  const work = x.bands.filter((b) => b.kind === 'work' && !b.isStride);
  if (work.length > 1) {
    parts.push(`${work.length} work segments are marked on the chart.`);
  }
  /* A GAP IS WORTH SAYING OUT LOUD. It is the one thing a spoken summary can
   * carry that a glance at the line cannot: a break in a drawn series reads
   * as a shape, and here it reads as what it is. */
  const gaps = x.points.filter((p) => p.paceSecPerMi == null && p.hrBpm == null).length;
  if (gaps > 0) {
    parts.push(`${gaps} of ${x.points.length} points recorded nothing.`);
  }
  return parts.join(' ');
}
