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
