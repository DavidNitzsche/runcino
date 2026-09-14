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
 * CANONICAL-1 (2026-09-13) · PREFER THE CANONICAL ROW'S OWN SPLITS, WHEN
 * THEY ARE USABLE, BEFORE RACING COVERAGE ACROSS SIBLINGS.
 *
 * The Santa Monica 10K, real production shape (`runs.id -159534527913687`,
 * canonical `source:'watch'`, twin `source:'apple_watch'` at
 * `id -2879323795619998`): the run is 6.28 mi. The canonical's own splits are
 * six whole miles — 6:52 / 6:59 / 7:17 / 7:51 / 7:44 / 7:02, verified against
 * Strava's own splits and against `deriveSplitsFromPaceSamples` run fresh
 * over the same pace stream, all three agreeing within a second per mile.
 * `splitsCoverageMi` scores that array at 6.00 mi (it carries no
 * `distanceMi` per split, so each one defaults to 1 — see that function),
 * against the true 6.28. The absorbed HealthKit twin carries an explicit
 * `distanceMi` on every split, summing to 6.278 — because
 * `HealthKitImporter.perMileSplits` sums raw fix-to-fix GPS haversine
 * distance with no interpolation and no odometer normalization, which
 * over-counts during the GPS "warm-up" in the first mile or two and happens
 * to land almost exactly on the true total. Pure coverage-gap racing
 * (`|6.00-6.28| = 0.28` vs `|6.278-6.28| ≈ 0.002`) therefore picked the
 * inflated, wrong array over the correct one, and did so ~10s/mi wrong on
 * three of the six miles.
 *
 * The general shape: `deriveSplitsFromPaceSamples` (and the watch's own
 * on-device split derivation it mirrors) reports WHOLE MILES ONLY — see its
 * own header, "the whole-run entry point still returns whole miles only ...
 * this function ignores [the trailing remainder], exactly as it always has."
 * Any run that doesn't end on an exact mile boundary — which is most runs,
 * and effectively every race — therefore leaves the canonical array
 * "short" of the true distance by up to just under a mile, BY DESIGN, no
 * matter how accurate every split in it is. A coverage-sum race with no
 * concept of that design fact will systematically prefer whichever sibling
 * happens to encode a fractional tail, accurate or not — this is a Rule 9
 * shape (the fitter/more-honest array loses on a near-threshold gap) hiding
 * inside what reads as a data-quality check.
 *
 * The fix asks the question the array's own shape can answer honestly: does
 * the canonical cover as many WHOLE miles as the run has, not does its
 * coverage SUM land within a quarter mile of the true total. That is exactly
 * what distinguishes this case from the one `pickSplits` was ORIGINALLY built
 * to fix (2026-08-24, see the module header above): 4.02 mi run, canonical
 * only 3 splits — short of `floor(4.02) = 4`, a genuinely missing whole mile
 * (the last one, 158 bpm, Z4) — where the fuller twin correctly wins. Santa
 * Monica's canonical carries 6 splits against `floor(6.28) = 6`: complete by
 * this measure, incomplete only by the coverage-sum test, because the
 * "gap" the sum sees is the ordinary trailing partial the derivation always
 * omits, not a lost mile.
 *
 * `usable` therefore means: at least as many whole-mile splits as the run has
 * whole miles. Genuinely short (a real missing mile, or an empty/absent
 * array) still falls through to the coverage race below — unchanged from
 * before — so the sibling with real additional coverage still wins in that
 * case exactly as it did on 2026-08-24. Richness breaks a tie, because a mile
 * with a heart rate is worth more than a mile without one and neither is
 * worth anything if it is not there.
 *
 * Returns null when no candidate carries splits at all. It never merges two
 * arrays: they are separate observations of the run by separate instruments,
 * and interleaving them would invent miles that no instrument recorded.
 *
 * Rule 11 · the fallback (coverage race, non-canonical winner) is a
 * DIFFERENT fact from a canonical read, and it stays distinguishable exactly
 * the way it always was: `SplitChoice.source` carries the literal winning
 * candidate's own source (`'canonical'` only when the canonical row's array
 * actually won), and every caller downstream already keys off that field
 * (`MILEFALLBACK-LABEL-1` in `app/api/v5/today/route.ts`) rather than
 * assuming canonical.
 */
export function pickSplits(
  runDistanceMi: number | null | undefined,
  candidates: SplitCandidate[],
): SplitChoice | null {
  const mi = Number(runDistanceMi);
  const hasMi = Number.isFinite(mi) && mi > 0;

  const canonicalCandidate = candidates.find((c) => c.source === 'canonical');
  if (
    canonicalCandidate
    && Array.isArray(canonicalCandidate.splits)
    && canonicalCandidate.splits.length > 0
  ) {
    const coverage = splitsCoverageMi(canonicalCandidate.splits);
    // With no run distance to judge against, the canonical's own array is
    // usable by definition — there is nothing to be short OF. Otherwise a
    // whole-mile-only array is usable when it has at least as many splits as
    // the run has whole miles; the trailing partial mile it never numbers is
    // not a hole.
    const wholeMilesExpected = hasMi ? Math.floor(mi) : canonicalCandidate.splits.length;
    if (canonicalCandidate.splits.length >= wholeMilesExpected) {
      return {
        splits: canonicalCandidate.splits,
        source: canonicalCandidate.source ?? null,
        coverageMi: coverage,
        coversRun: hasMi ? Math.abs(coverage - mi) <= COVERAGE_TOLERANCE_MI : false,
      };
    }
  }

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
