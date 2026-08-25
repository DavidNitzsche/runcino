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
import type { ZoneTable } from '@/lib/training/zones';

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
 * Classify one HR reading into a zone idx.
 *
 * Exact match first. The bands TILE as of 2026-08-24 (`tiledBands` in
 * lib/training/zones.ts), so every beat from 0 to the top zone's ceiling has
 * exactly one owner and the exact match is what actually runs. The snap below
 * survives for the only case left — a reading ABOVE the top band, which the
 * doctrine table does not cover — and for any future table that does not tile.
 *
 * It used to carry the gaps: Friel computed each floor and each ceiling from
 * two independent roundings, so at LTHR 162 Z2 ended at 144, Z3 began at 146,
 * and 145 was snapped to the nearest band MIDPOINT while the legend on the
 * same screen showed neither band containing it.
 *
 * EXPORTED so `lib/coach/run-state.ts` stops keeping its own copy. Two
 * implementations of one rule is the defect class this whole layer exists for.
 */
export function classify(bpm: number, table: ZoneTable): number {
  const exact = table.zones.find((zz) => bpm >= zz.lower && bpm <= zz.upper);
  if (exact) return exact.idx;
  let bestIdx = table.zones[0]?.idx ?? 1;
  let bestDist = Infinity;
  for (const zz of table.zones) {
    const mid = (zz.lower + zz.upper) / 2;
    const dist = Math.abs(bpm - mid);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = zz.idx;
    }
  }
  return bestIdx;
}

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
      const idx = classify(bpm - hrOffsetBpm, table);
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
    const idx = classify(bpm - hrOffsetBpm, table);
    counts[idx] = (counts[idx] ?? 0) + 1;
  }
  const share = apportionToHundred([counts[1], counts[2], counts[3], counts[4], counts[5]]);
  if (!share) return null;
  return { z1: share[0], z2: share[1], z3: share[2], z4: share[3], z5: share[4] };
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
