/**
 * WHICH SPLIT ARRAY DESCRIBES THE RUN.
 *
 * A merged run carries a split array from every ingest that saw it, and they
 * are not copies of each other. They disagree about how many miles the run
 * had, about which fields each mile carries, and — the part that matters —
 * about whether the array covers the whole run at all.
 *
 * His 2026-08-24 run, 4.02 miles:
 *
 *     canonical  (watch)        3 splits, 3.00 mi, {mile, pace, paceSecPerMi, hr}
 *     twin       (apple_watch)  5 splits, 4.11 mi, + cadence, elev_ft, distanceMi
 *
 * The merge kept the canonical's. A quarter of the run had no split, the last
 * mile he ran was missing entirely, and that missing mile is where the effort
 * was: 158 bpm, Z4, the 4% the zone tile reports and no other surface could
 * show. He asked the obvious question — "why are we not taking the 4 miles and
 * making each mile a split?" — and the answer was that his watch already had,
 * and the merge discarded it.
 *
 * True of 26 of the 71 merged runs in this database.
 *
 * This is the third instance of one rule, after the clock family and the
 * elevation instruments: a merge that picks per-field, with no idea which
 * SOURCE is better for that field, will sometimes keep the worse one. Coverage
 * is the test here, because a split array's whole job is to decompose the run.
 */

import { fmtPace } from '@/lib/format/run';

export interface SplitLike {
  mile?: unknown;
  pace?: unknown;
  paceSecPerMi?: unknown;
  hr?: unknown;
  cadence?: unknown;
  elev_ft?: unknown;
  elev_change_ft?: unknown;
  distanceMi?: unknown;
  distance_mi?: unknown;
}

/** Miles this array claims to describe. A split with no distance is one mile. */
export function splitsCoverageMi(splits: SplitLike[] | null | undefined): number {
  if (!Array.isArray(splits)) return 0;
  let total = 0;
  for (const s of splits) {
    const raw = s.distanceMi ?? s.distance_mi;
    const d = raw == null ? 1 : Number(raw);
    total += Number.isFinite(d) && d > 0 ? d : 1;
  }
  return total;
}

/** How many of the fields a breakdown wants this array actually carries. */
function richness(splits: SplitLike[]): number {
  let n = 0;
  for (const key of ['hr', 'cadence', 'elev_ft', 'elev_change_ft', 'distanceMi', 'distance_mi'] as const) {
    if (splits.some((s) => s[key] != null)) n++;
  }
  return n;
}

export interface SplitCandidate {
  splits: SplitLike[] | null | undefined;
  /** For the report only — which ingest wrote it. */
  source?: string | null;
}

/** The one raw phase field this fallback reads. Matches `runs.data.phases[]`
 *  verbatim — see `readStrides`'s own `GradedPhase` for the graded sibling. */
export interface PhaseLikeForFallback {
  type?: unknown;
  isStrideSegment?: unknown;
  actualDistanceMi?: unknown;
  actualPaceSPerMi?: unknown;
  avgHr?: unknown;
}

/**
 * ROUTING-1 (2026-09-09) · ONE HONEST ROW, for the window no split source has
 * anything at all.
 *
 * `runs` rows for a single watch completion are written in more than one
 * POST, merged by `data || jsonb_strip_nulls(EXCLUDED.data)` — confirmed on
 * the owner's own 2026-09-09 5-mile-easy-plus-6-strides row, whose `fetched_at`
 * (14:17:04) sits 19 minutes before its own `data.ingestedAt` (14:36:46). In
 * that window a canonical row can carry `phases` — the watch's own per-phase
 * telemetry, written directly, never derived — with no `splits` array yet,
 * because `deriveSplitsFromPaceSamples` runs at write time over whatever
 * `phases` THAT post carried.
 *
 * `pickSplits` correctly returns null when nothing has a split array. Without
 * this, that null becomes `routeSplits: []`, `hasMiles` false on the phone,
 * and `PostRunShapeV5.decomposition` — CORRECTLY, given that false input —
 * routes an easy run with real recorded miles into the section lane, which
 * has no pace field at all.
 *
 * `phases[].actualDistanceMi` / `actualPaceSPerMi` are the watch's own
 * distance-over-time for the session's continuous body, and they exist from
 * the same write that put `phases` on the row — no derivation to race against.
 * Returns exactly ONE row when the run has exactly one non-stride work phase
 * — the unambiguous "one continuous effort" case `.steady`/`.longSteady`/
 * `.progression` decompose to `.miles` for — and null otherwise: a session
 * built from more than one work block (tempo, threshold, reps) does not get
 * one averaged row standing in for pieces that were never one effort, which
 * is the same ruling `PostRunShapeV5.showsWholeRunPace` already makes.
 *
 * `mile: 1` is a placeholder ordinal, not a claim about mile-cut boundaries —
 * `distanceMi` carries the real length, and `MileBreakdownV5.pieces` sizes the
 * row off that field, not off the ordinal.
 */
export function phaseFallbackSplits(phases: unknown): SplitLike[] | null {
  if (!Array.isArray(phases)) return null;
  const body = phases.filter((p): p is PhaseLikeForFallback => (
    !!p && typeof p === 'object'
    && (p as PhaseLikeForFallback).type === 'work'
    && (p as PhaseLikeForFallback).isStrideSegment !== true
  ));
  if (body.length !== 1) return null;
  const p = body[0];
  const distanceMi = Number(p.actualDistanceMi);
  const paceSecPerMi = Number(p.actualPaceSPerMi);
  if (!Number.isFinite(distanceMi) || distanceMi <= 0) return null;
  if (!Number.isFinite(paceSecPerMi) || paceSecPerMi <= 0) return null;
  // Presence, not magnitude — `p.avgHr == null` is "unmeasured"; a finite
  // reading of any size is a real one. `> 0` here would read a genuinely
  // absent avgHr and a syntactically-zero one as the same case the scanner
  // exists to catch (`lib/audit/coercion-scan.ts`'s ZERO-ERASURE shape).
  const hr = p.avgHr == null ? NaN : Number(p.avgHr);
  return [{
    mile: 1,
    pace: fmtPace(paceSecPerMi),
    hr: Number.isFinite(hr) ? Math.round(hr) : null,
    distanceMi,
  }];
}

export interface SplitChoice {
  splits: SplitLike[];
  source: string | null;
  coverageMi: number;
  /** True when the array decomposes the run within tolerance. */
  coversRun: boolean;
}

/** A split array may miss or overshoot the run by this much and still be said
 *  to cover it. A quarter mile is a trailing partial or a GPS rounding, not a
 *  missing mile. */
export const COVERAGE_TOLERANCE_MI = 0.25;

/**
 * The array that best decomposes this run.
 *
 * Coverage first — an array that describes three miles of a four-mile run is
 * wrong about the run no matter how nicely formed it is. Richness breaks a
 * tie, because a mile with a heart rate is worth more than a mile without one
 * and neither is worth anything if it is not there.
 *
 * Returns null when no candidate carries splits at all. It never merges two
 * arrays: they are separate observations of the run by separate instruments,
 * and interleaving them would invent miles that no instrument recorded.
 */
export function pickSplits(
  runDistanceMi: number | null | undefined,
  candidates: SplitCandidate[],
): SplitChoice | null {
  const mi = Number(runDistanceMi);
  let best: SplitChoice | null = null;
  let bestGap = Infinity;
  let bestRich = -1;

  for (const c of candidates) {
    if (!Array.isArray(c.splits) || c.splits.length === 0) continue;
    const coverage = splitsCoverageMi(c.splits);
    // With no run distance to judge against, the longest array wins — it is
    // the only ordering available, and it is never worse than arbitrary.
    const gap = Number.isFinite(mi) && mi > 0 ? Math.abs(coverage - mi) : -coverage;
    const rich = richness(c.splits);
    if (gap < bestGap || (gap === bestGap && rich > bestRich)) {
      bestGap = gap;
      bestRich = rich;
      best = {
        splits: c.splits,
        source: c.source ?? null,
        coverageMi: coverage,
        coversRun: Number.isFinite(mi) && mi > 0 ? Math.abs(coverage - mi) <= COVERAGE_TOLERANCE_MI : false,
      };
    }
  }
  return best;
}
