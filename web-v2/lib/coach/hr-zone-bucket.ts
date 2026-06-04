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

const EMPTY: ZonePcts = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };

/**
 * Classify one HR reading into a zone idx (1-5). Exact match first;
 * if the reading falls in a gap between bands (Friel rounds with
 * 1-bpm gaps · e.g. Z2 upper 144, Z3 lower 146 at LTHR=162), snap
 * to the nearest band by midpoint distance.
 *
 * Same rule as the legacy `classify` inside `deriveHrZones` · keep
 * them aligned so the per-sample path produces a result consistent
 * with the per-split-avg fallback when samples are absent.
 */
function classify(bpm: number, table: ZoneTable): number {
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
 * Walk every HR sample across every split and aggregate time per
 * zone. Returns z1-z5 percentages summing to 100 (or 0 if no usable
 * samples found).
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
): ZonePcts {
  if (!table) return EMPTY;
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  for (const s of splits ?? []) {
    const samples = s?._raw?.hrSamples ?? s?.hrSamples ?? [];
    for (const samp of samples) {
      const bpm = Number(samp?.bpm) || 0;
      if (bpm < 40 || bpm > 230) continue;
      const idx = classify(bpm, table);
      counts[idx] = (counts[idx] ?? 0) + 1;
      total++;
    }
  }
  if (total === 0) return EMPTY;
  return {
    z1: Math.round((counts[1] / total) * 100),
    z2: Math.round((counts[2] / total) * 100),
    z3: Math.round((counts[3] / total) * 100),
    z4: Math.round((counts[4] / total) * 100),
    z5: Math.round((counts[5] / total) * 100),
  };
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
