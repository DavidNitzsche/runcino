/**
 * hr-zone-bucket.ts · single source of truth for time-weighted
 * HR-zone bucketing across a run.
 *
 * 2026-06-04 · David's QC: the Run Detail page TIME IN ZONES bar
 * read "Z1 33% / Z4 33% / Z5 33%" on a tempo workout, with Z2/Z3
 * showing 0%. The runner's tempo block was 36 minutes at avg HR 162
 * (= LTHR), warm-up was 13 min, cool-down was 10 min · the bar
 * said three equal 33% slices because the legacy `deriveHrZones`
 * bucketed BY SPLIT COUNT, not by time, and used the phase AVG HR
 * to assign a single zone per split instead of bucketing every
 * sample. So three phases got 1/3 weight each, and the tempo phase
 * landed in Z5 because its avg HR hit Z5's lower bound exactly.
 *
 * This module fixes that. Given the raw HR samples the watch ships
 * (every 5 seconds, ~720 samples for a 60-minute run), it buckets
 * each sample individually using the runner's LTHR/MaxHR-derived
 * zone table. Result is naturally time-weighted because the samples
 * are time-evenly-spaced.
 *
 * Cite: Research/03-heart-rate-zones.md §6 (Friel) · zones.ts is
 * the band definition source · this module is the bucketing engine.
 *
 * Used by:
 *   · app/api/ingest/workout/route.ts · compute + persist
 *     `data.hrZonePcts` at watch ingest so the row carries an
 *     honest distribution out of the gate.
 *   · lib/coach/run-state.ts · fallback at render time when the
 *     stored value is missing (covers existing runs ingested
 *     before this fix).
 */
/* ZONE-BANDS-1 (2026-08-24) · this module used to carry its own `classify`,
 * which snapped a reading that fell in a GAP between two bands to whichever
 * band's midpoint was nearest. There are no gaps any more — `zoneIdxForBpm`
 * is total, because the bands now tile the line — so the snap is deleted
 * rather than kept as a safety net. A safety net under a hole is how the hole
 * stayed open: the bucketer looked correct while 138 bpm, claimed by both Z1
 * and Z2, went to Z1 on a `.find()` that returned the first match. That is
 * 85.2% of a 162 LTHR — Z2 by doctrine, and read as Recovery for a year. */
import { zoneIdxForBpm, type ZoneTable } from '@/lib/training/zones';

/* ZONES-SUM-1 (2026-08-24) · the apportionment lives in `lib/runs/coherence.ts`
 * with the rest of the arithmetic that makes a row agree with itself, and is
 * re-exported here for the callers already reaching for it. One implementation:
 * the read path normalises a STORED distribution with the same function this
 * write path uses to build one, so the two cannot round differently. */
import { apportionToHundred } from '@/lib/runs/coherence';
export { apportionToHundred };

export interface HrSample {
  bpm?: number;
  tSec?: number;
}

export interface RawSplit {
  _raw?: {
    hrSamples?: HrSample[];
  };
  hrSamples?: HrSample[];
  hr?: number | null;
  avgHr?: number | null;
}

export type ZonePcts = {
  z1: number;
  z2: number;
  z3: number;
  z4: number;
  z5: number;
};

/**
 * Walk every HR sample across every split and aggregate time per zone.
 *
 * Returns five percentages summing to exactly 100, or NULL when there is
 * nothing to distribute — no zone table (the runner has no LTHR) or no usable
 * sample. Null is a refusal and callers must treat it as one: five zeros is a
 * different claim, and it is false. See ZONES-SUM-1 above.
 *
 * Time-weighted because samples are time-evenly-spaced · counting
 * samples == counting seconds (modulo the constant interval). No
 * need to know the interval explicitly.
 *
 * Skip samples with bpm null/undefined/zero · the watch occasionally
 * ships a sentinel reading at the very start before HR data is
 * ready. Those would land in Z1 and falsely inflate the recovery
 * slice.
 */
export function bucketHrSamplesByZone(
  splits: RawSplit[],
  table: ZoneTable | null,
  // 2026-06-08 · optional heat offset · subtract the expected heat HR-bump
  // from each reading before classifying, so a hot-day easy run is judged
  // against zones shifted up by the bump (the HR analog of heat-band.ts
  // widening the pace band). Default 0 = no change for every existing caller.
  hrOffsetBpm = 0,
): ZonePcts | null {
  if (!table) return null;
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  for (const s of splits ?? []) {
    const samples = s?._raw?.hrSamples ?? s?.hrSamples ?? [];
    for (const samp of samples) {
      const bpm = Number(samp?.bpm) || 0;
      if (bpm < 40 || bpm > 230) continue;
      const idx = zoneIdxForBpm(bpm - hrOffsetBpm, table);
      if (idx == null) continue;
      counts[idx] = (counts[idx] ?? 0) + 1;
      total++;
    }
  }
  const share = apportionToHundred([counts[1], counts[2], counts[3], counts[4], counts[5]]);
  if (!share) return null;
  return { z1: share[0], z2: share[1], z3: share[2], z4: share[3], z5: share[4] };
}

/**
 * Time in zone from PER-MILE average heart rates, when the run carries no
 * per-second samples. One mile, one vote — coarse, and honest about being a
 * decomposition of the run rather than a guess at one.
 *
 * Returns null when no split carries a heart rate, and that is the whole
 * point of it being a separate function.
 *
 * ── ZONES-SUM-2 (2026-08-24) · WHAT THIS REPLACED ─────────────────────────
 *
 * `deriveHrZones` in `lib/coach/run-state.ts` used to end, when no split
 * carried an HR:
 *
 *     // No splits — assign 100% to the band the avg HR falls in.
 *     return { ...empty, [`z${classify(avgHr).idx}`]: 100 };
 *
 * A bar chart of where a runner's heart spent an hour, drawn from one
 * averaged figure that says nothing about where any of it went. Every run
 * with a warm-up disproves it on sight: a tempo averaging 150 bpm did not
 * spend all of itself in Z3, it spent some in Z1 and some in Z4, and the
 * average is what was left after that information was discarded.
 *
 * It summed to 100, so it satisfied `RunDetail.hrZonePcts`'s own contract and
 * every guard downstream — the same defect five-zeros was, wearing the
 * opposite shape. It reached 16 of the 149 canonical runs: every treadmill
 * and apple_watch row carrying an average and no per-mile detail.
 *
 * There is no honest distribution to be had from one number, so there is no
 * distribution. Rule one and rule three at once.
 */
export function zoneSharesFromSplitHr(
  splits: ReadonlyArray<{ hr?: number | null; avgHr?: number | null }>,
  table: ZoneTable | null,
  hrOffsetBpm = 0,
): ZonePcts | null {
  if (!table) return null;
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const s of splits ?? []) {
    const bpm = Number(s?.hr ?? s?.avgHr) || 0;
    // The same readable range `bucketHrSamplesByZone` applies to a sample. A
    // strap sentinel is not a mile spent in Recovery.
    if (bpm < 40 || bpm > 230) continue;
    // `zoneIdxForBpm` is the ONE classifier now — the two midpoint-snap copies
    // that used to live here and in run-state.ts are gone, and with them the
    // silent reclassification of a beat that belonged to no band. It returns
    // null only for an unreadable beat, which the guard above already excluded.
    const idx = zoneIdxForBpm(bpm - hrOffsetBpm, table);
    if (idx == null) continue;
    counts[idx] = (counts[idx] ?? 0) + 1;
  }
  const share = apportionToHundred([counts[1], counts[2], counts[3], counts[4], counts[5]]);
  if (!share) return null;
  return { z1: share[0], z2: share[1], z3: share[2], z4: share[3], z5: share[4] };
}

/**
 * ANCHOR-STALE-1 (2026-08-30) · the zone distribution for a run, resolved
 * against the anchor the runner has TODAY.
 *
 * ── WHY THE STORED VALUE LOST ITS PRECEDENCE ────────────────────────────────
 *
 * `data.hrZonePcts` is computed at ingest and persisted on the row. The read
 * path used to take the stored value first and recompute only when it was
 * MISSING, so the stored value won forever. That is fine while the anchor it
 * was computed against is still the runner's anchor. It stops being fine the
 * moment the anchor moves, because nothing on the row records which anchor
 * produced it and nothing invalidates it when that anchor changes.
 *
 * The owner's threshold anchor was re-derived from race evidence on
 * 2026-08-30 (162 → 168 · `lib/training/lthr-reanchor.ts`). Every stored
 * distribution he holds was bucketed at 162. On his 2026-08-30 long run —
 * 13.49 mi, avg HR 159, an EASY long day — the stored value says
 * `{z1:4, z2:15, z3:11, z4:10, z5:60}`. Sixty percent of an easy long run in
 * Zone 5. Bucketing the SAME samples at 168 gives
 * `{z1:11, z2:17, z3:9, z4:36, z5:27}`, and Z5 stops being modal.
 *
 * Both numbers are arithmetically correct. Only one of them is about this
 * runner. The stored one passes every guard in `lib/runs/coherence.ts`,
 * because those guards ask whether a row agrees with ITSELF — they cannot ask
 * whether it agrees with an anchor they have never been shown.
 *
 * ── THE PRECEDENCE, AND THE ONE TRADE IT MAKES ──────────────────────────────
 *
 *   1. Per-sample bucketing · the watch's 5-second stream. Time-weighted,
 *      highest fidelity, and computed against the anchor passed in here.
 *   2. Per-mile averages · coarser, and the run's own measurement all the
 *      same. Same anchor.
 *   3. The STORED distribution, reconciled · only when the row carries
 *      nothing to recompute from.
 *
 * Rung 3 used to be rung 1. The trade is that a row whose per-second samples
 * were pruned after ingest now re-derives from its per-mile averages instead
 * of keeping a finer stored distribution — coarser, but anchored to the
 * runner who is reading it. That is the right way round: a precise answer to
 * the wrong question is not more accurate than an imprecise answer to the
 * right one, and only the recompute knows what the anchor is now. Verified
 * against the owner's eight stored rows — every one reproduces its stored
 * value EXACTLY when re-bucketed at 162, so nothing is lost by re-deriving
 * them at 168.
 *
 * `table` is the caller's ONE resolved anchor (`resolveThresholdHr` →
 * `computeZones`), passed in rather than re-read here, so the zone BAR and
 * the zone RANGES panel drawn beside it cannot come from different anchors.
 * A null table means the runner has no anchor at all: rungs 1 and 2 cannot
 * run, and the stored value is the only thing left.
 */
export function resolveHrZoneShares(args: {
  /** `data.phases` · where the watch actually writes its 5-second HR. */
  phases?: unknown;
  /** `data.splits` · older payloads put the samples here instead. */
  rawSplits?: unknown;
  /** Per-mile splits carrying an average `hr`, for rung 2. */
  splits?: ReadonlyArray<{ hr?: number | null; avgHr?: number | null }> | null;
  /** The already-reconciled stored distribution, or null. Rung 3. */
  storedPcts?: ZonePcts | null;
  /** The runner's CURRENT zone table. Null when they have no anchor. */
  table: ZoneTable | null;
  hrOffsetBpm?: number;
}): ZonePcts | null {
  const offset = args.hrOffsetBpm ?? 0;
  if (args.table) {
    // 1 · per-second samples, wherever the payload put them. `phases` first:
    // that is where the watch writes, and a run carrying both should be read
    // from the stream the device recorded.
    for (const src of [args.phases, args.rawSplits]) {
      const arr = Array.isArray(src) ? (src as RawSplit[]) : [];
      if (arr.length > 0 && hasHrSamples(arr)) {
        const next = bucketHrSamplesByZone(arr, args.table, offset);
        if (next) return next;
      }
    }
    // 2 · per-mile averages.
    const next = zoneSharesFromSplitHr(args.splits ?? [], args.table, offset);
    if (next) return next;
  }
  // 3 · nothing to recompute from. The stored value is all there is, and it
  // is better than refusing outright — it is only its ANCHOR that is in
  // doubt, not the fact that the run had a distribution.
  return args.storedPcts ?? null;
}

/**
 * Convenience · check whether ANY split in the array carries
 * usable raw HR samples. Used by the render fallback to decide
 * whether the per-sample bucketer can run · false means callers
 * should fall through to the per-split-avg legacy path.
 */
export function hasHrSamples(splits: RawSplit[]): boolean {
  for (const s of splits ?? []) {
    const samples = s?._raw?.hrSamples ?? s?.hrSamples ?? [];
    for (const samp of samples) {
      const bpm = Number(samp?.bpm) || 0;
      if (bpm >= 40 && bpm <= 230) return true;
    }
  }
  return false;
}
