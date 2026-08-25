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
