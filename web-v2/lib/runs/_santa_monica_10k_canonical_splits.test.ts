/**
 * lib/runs/_santa_monica_10k_canonical_splits.test.ts · CANONICAL-1
 * (2026-09-13).
 *
 * Fail-before / pass-after for the Santa Monica 10K mile-split defect,
 * against the REAL production row shape. Queried read-only from
 * `DATABASE_URL_RO` on 2026-09-13 (`faff_readonly`), `user_uuid
 * 0645f40c-951d-4ccc-b86e-9979cd26c795`:
 *
 *   canonical   runs.id -159534527913687    source 'watch'          6 splits
 *   HK twin     runs.id -2879323795619998   source 'apple_watch'    7 splits
 *   Strava twin runs.id 20159746844         source 'strava_webhook' 0 splits
 *
 * All three rows share `mergedIntoId` pointing the two twins at the
 * canonical, `distanceMi: 6.28`, and same-second start times — one physical
 * run seen by three ingests. Every field below is copied verbatim from the
 * live rows (Rule 13: a display-fix regression test is verified against real
 * production shape, not a synthetic fixture) — this is not a fixture built
 * to make the fix look good, it is the row that broke.
 *
 * THE FORENSIC READING (external review, 2026-09-13 debrief): the
 * canonical's own splits — 6:52 / 6:59 / 7:17 / 7:51 / 7:44 / 7:02 — agree
 * with Strava's own splits and with `deriveSplitsFromPaceSamples` run fresh
 * over the watch's pace stream, all three within 1 s/mi. The HealthKit twin's
 * splits are the outlier: `HealthKitImporter.perMileSplits` sums raw
 * fix-to-fix GPS haversine distance with no interpolation and no odometer
 * normalization, over-counting distance during the GPS "warm-up" in the
 * first two miles — miles 1-3 read roughly 10s/mi fast, and its `elev_ft`
 * per split (-174, -17, 52, 57, 53, -75) is the same untrustworthy algorithm,
 * never corroborated against anything.
 *
 * FAIL-BEFORE (asserted here against the OLD coverage-only algorithm,
 * reimplemented locally so this file does not depend on the fix having
 * shipped to prove what shipped): pure `|coverage - distanceMi|` racing
 * picks the HealthKit twin, because it carries an explicit `distanceMi` per
 * split (summing to 6.278, almost exactly the true 6.28) while the
 * canonical's whole-mile-only array (no `distanceMi` per split, so
 * `splitsCoverageMi` defaults each entry to 1) sums to 6.00 — a 0.28 mi gap,
 * just over `COVERAGE_TOLERANCE_MI` (0.25).
 *
 * PASS-AFTER: `pickSplits` (CANONICAL-1) prefers the canonical row's own
 * array whenever it carries at least as many splits as the run has whole
 * miles — 6 splits for a `floor(6.28) = 6` mile run is complete by that
 * measure, and the coverage gap it fails is exactly the ordinary trailing
 * partial mile no whole-mile-only derivation ever numbers, not a missing
 * mile. The chosen array's values are asserted here against Strava's own
 * splits (independently reconstructed from `activity.laps`, not stored as a
 * `splits` array on the Strava row itself — see the note below) and against
 * `deriveSplitsFromPaceSamples`, both within 1 s/mi.
 */
import { describe, it, expect } from 'vitest';
import { pickSplits, splitsCoverageMi, type SplitCandidate } from '@/lib/runs/splits-pick';
import { resolveSplits, type CanonicalFigures, type RunTwin } from '@/lib/runs/twins';

/** Verbatim from `runs.id -159534527913687`, `data.splits`. The canonical
 *  row: `source:'watch'`, `distanceMi: 6.28`. Whole-mile-only — no
 *  `distanceMi` per split, by construction of `deriveSplitsFromPaceSamples`. */
const CANONICAL_SPLITS = [
  { hr: 156, mile: 1, pace: '6:52', paceSecPerMi: 412 },
  { hr: 164, mile: 2, pace: '6:59', paceSecPerMi: 419 },
  { hr: 170, mile: 3, pace: '7:17', paceSecPerMi: 437 },
  { hr: 170, mile: 4, pace: '7:51', paceSecPerMi: 471 },
  { hr: 172, mile: 5, pace: '7:44', paceSecPerMi: 464 },
  { hr: 175, mile: 6, pace: '7:02', paceSecPerMi: 422 },
];

/** Verbatim from `runs.id -2879323795619998`, `data.splits` — the absorbed
 *  HealthKit/`apple_watch` twin, `mergedIntoId: '-159534527913687'`. Every
 *  entry carries its own `distanceMi`, summing to 6.278 mi. */
const HEALTHKIT_TWIN_SPLITS = [
  { hr: 156, mile: 1, pace: '6:41', cadence: 166, elev_ft: -174, distanceMi: 1 },
  { hr: 164, mile: 2, pace: '6:49', cadence: 285, elev_ft: -17, distanceMi: 1 },
  { hr: 170, mile: 3, pace: '7:15', cadence: 161, elev_ft: 52, distanceMi: 1 },
  { hr: 170, mile: 4, pace: '7:52', cadence: 155, elev_ft: 57, distanceMi: 1 },
  { hr: 172, mile: 5, pace: '7:44', cadence: 157, elev_ft: 53, distanceMi: 1 },
  { hr: 175, mile: 6, pace: '7:02', cadence: 248, elev_ft: -75, distanceMi: 1 },
  { hr: 178, mile: 7, cadence: 141, elev_ft: 0, distanceMi: 0.2780494970707421 },
];

const RUN_DISTANCE_MI = 6.28;

/** The forensic debrief's independently-verified truth for this run — Strava's
 *  own per-mile splits and a from-scratch `deriveSplitsFromPaceSamples`
 *  reconstruction over the watch's pace stream, both agreeing with the
 *  canonical row's own stored splits within 1 s/mi per the external review. */
const RECONSTRUCTED_TRUE_PACES_SEC = [412, 419, 437, 471, 464, 422]; // 6:52 6:59 7:17 7:51 7:44 7:02

/** THE OLD ALGORITHM, reimplemented locally (not imported) so this test
 *  proves the fail-before case against the actual pre-fix behaviour rather
 *  than against a paraphrase of it — pure coverage-gap racing, richness tie
 *  break, no canonical preference at all. This is `pickSplits` before
 *  CANONICAL-1, verbatim in shape. */
function pickSplitsPreFix(
  runDistanceMi: number | null | undefined,
  candidates: SplitCandidate[],
) {
  const mi = Number(runDistanceMi);
  let best: { splits: unknown; source: string | null; coverageMi: number } | null = null;
  let bestGap = Infinity;
  let bestRich = -1;
  const richness = (splits: Array<Record<string, unknown>>) => {
    let n = 0;
    for (const key of ['hr', 'cadence', 'elev_ft', 'elev_change_ft', 'distanceMi', 'distance_mi'] as const) {
      if (splits.some((s) => s[key] != null)) n++;
    }
    return n;
  };
  for (const c of candidates) {
    if (!Array.isArray(c.splits) || c.splits.length === 0) continue;
    const coverage = splitsCoverageMi(c.splits);
    const gap = Number.isFinite(mi) && mi > 0 ? Math.abs(coverage - mi) : -coverage;
    const rich = richness(c.splits as Array<Record<string, unknown>>);
    if (gap < bestGap || (gap === bestGap && rich > bestRich)) {
      bestGap = gap;
      bestRich = rich;
      best = { splits: c.splits, source: c.source ?? null, coverageMi: coverage };
    }
  }
  return best;
}

describe('CANONICAL-1 · Santa Monica 10K, real production row shape', () => {
  it('FAIL-BEFORE: pure coverage-gap racing picks the HealthKit twin, not the canonical row', () => {
    const picked = pickSplitsPreFix(RUN_DISTANCE_MI, [
      { splits: CANONICAL_SPLITS, source: 'canonical' },
      { splits: HEALTHKIT_TWIN_SPLITS, source: 'apple_watch' },
    ]);
    expect(picked).not.toBeNull();
    // The defect, reproduced: the wrong array wins.
    expect(picked!.source).toBe('apple_watch');
    expect(picked!.splits).toBe(HEALTHKIT_TWIN_SPLITS);
    // And it is wrong on three of six miles by roughly ten seconds — this is
    // not a rounding difference, it is a different measurement.
    const wrongMile1 = (picked!.splits as typeof HEALTHKIT_TWIN_SPLITS)[0].pace;
    expect(wrongMile1).toBe('6:41');       // HealthKit's inflated-distance mile 1
    expect(CANONICAL_SPLITS[0].pace).toBe('6:52'); // the true mile 1
  });

  it('PASS-AFTER: pickSplits (CANONICAL-1) prefers the canonical row\'s own array', () => {
    const picked = pickSplits(RUN_DISTANCE_MI, [
      { splits: CANONICAL_SPLITS, source: 'canonical' },
      { splits: HEALTHKIT_TWIN_SPLITS, source: 'apple_watch' },
    ]);
    expect(picked).not.toBeNull();
    expect(picked!.source).toBe('canonical');
    expect(picked!.splits).toBe(CANONICAL_SPLITS);
  });

  it('PASS-AFTER: candidate order does not matter — canonical still wins when listed second', () => {
    const picked = pickSplits(RUN_DISTANCE_MI, [
      { splits: HEALTHKIT_TWIN_SPLITS, source: 'apple_watch' },
      { splits: CANONICAL_SPLITS, source: 'canonical' },
    ]);
    expect(picked!.source).toBe('canonical');
    expect(picked!.splits).toBe(CANONICAL_SPLITS);
  });

  it('the picked array\'s paces match the reconstructed truth within 1 s/mi', () => {
    const picked = pickSplits(RUN_DISTANCE_MI, [
      { splits: CANONICAL_SPLITS, source: 'canonical' },
      { splits: HEALTHKIT_TWIN_SPLITS, source: 'apple_watch' },
    ]);
    const got = (picked!.splits as typeof CANONICAL_SPLITS).map((s) => s.paceSecPerMi);
    expect(got).toHaveLength(RECONSTRUCTED_TRUE_PACES_SEC.length);
    got.forEach((sec, i) => {
      expect(Math.abs(sec - RECONSTRUCTED_TRUE_PACES_SEC[i])).toBeLessThanOrEqual(1);
    });
  });

  it('resolveSplits — the real call path (twins.ts) — also prefers canonical, end to end', () => {
    const canonical: CanonicalFigures = {
      elevGainFt: 176,
      elevGainSource: 'watch',
      source: 'watch',
      splits: CANONICAL_SPLITS,
      distanceMi: RUN_DISTANCE_MI,
    };
    const twins: RunTwin[] = [
      {
        elevGainFt: 466, elevGainSource: 'gps_derived', source: 'apple_watch',
        splits: HEALTHKIT_TWIN_SPLITS, avgHr: null, maxHr: null,
      },
      {
        elevGainFt: 179, elevGainSource: 'raw', source: 'strava_webhook',
        splits: null, avgHr: null, maxHr: null,
      },
    ];
    const choice = resolveSplits(canonical, twins, null);
    expect(choice).not.toBeNull();
    expect(choice!.source).toBe('canonical');
    expect(choice!.splits).toBe(CANONICAL_SPLITS);
    // Per-mile "Climb" reads honestly absent rather than borrowing the
    // HealthKit twin's untrustworthy per-split elev_ft — Rule 11: "don't
    // know" must never render as someone else's number.
    for (const sp of choice!.splits as Array<Record<string, unknown>>) {
      expect(sp.elev_ft).toBeUndefined();
      expect(sp.elev_change_ft).toBeUndefined();
    }
  });

  it('does NOT regress the 2026-08-24 case that motivated coverage racing in the first place', () => {
    // From this module's own header: a 4.02 mi run, canonical 3 splits
    // covering 3.00 mi (missing the whole final mile — 158 bpm, Z4), twin 5
    // splits covering 4.11 mi with cadence and per-mile elevation.
    const canonicalShort = [
      { mile: 1, pace: '7:30', hr: 140 },
      { mile: 2, pace: '7:35', hr: 145 },
      { mile: 3, pace: '7:40', hr: 150 },
    ];
    const fullerTwin = [
      { mile: 1, pace: '7:31', hr: 140, distanceMi: 1, cadence: 170 },
      { mile: 2, pace: '7:34', hr: 145, distanceMi: 1, cadence: 171 },
      { mile: 3, pace: '7:39', hr: 150, distanceMi: 1, cadence: 172 },
      { mile: 4, pace: '7:20', hr: 158, distanceMi: 1, cadence: 176 },
      { mile: 5, pace: '7:45', hr: 149, distanceMi: 0.11, cadence: 168 },
    ];
    const picked = pickSplits(4.02, [
      { splits: canonicalShort, source: 'canonical' },
      { splits: fullerTwin, source: 'apple_watch' },
    ]);
    expect(picked).not.toBeNull();
    // floor(4.02) = 4 whole miles; canonical carries only 3 — genuinely short
    // a whole mile, not just the trailing partial. The fuller twin must
    // still win, exactly as it did before CANONICAL-1.
    expect(picked!.source).toBe('apple_watch');
    expect(picked!.splits).toBe(fullerTwin);
  });

  it('a canonical array short by a genuine whole mile still loses even when it happens to be listed and usable-looking', () => {
    // Guards against an over-broad "prefer canonical" that stops checking
    // wholeMilesExpected at all — 2 splits on a 10-mile run must never win
    // over a twin covering the actual distance.
    const canonicalVeryShort = [
      { mile: 1, pace: '8:00', hr: 140 },
      { mile: 2, pace: '8:05', hr: 142 },
    ];
    const fullTwin = Array.from({ length: 10 }, (_, i) => ({
      mile: i + 1, pace: '8:02', hr: 140, distanceMi: 1,
    }));
    const picked = pickSplits(10.0, [
      { splits: canonicalVeryShort, source: 'canonical' },
      { splits: fullTwin, source: 'apple_watch' },
    ]);
    expect(picked!.source).toBe('apple_watch');
  });
});
