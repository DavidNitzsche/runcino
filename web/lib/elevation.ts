/**
 * DEM elevation pipeline.
 *
 * Queries OpenTopoData for SRTM 30m and NED 10m elevations, selects
 * the better dataset by loop-closure error, and injects demEleM onto
 * every GpxPoint in the track.
 *
 * Dataset-specific sampling (from benchmark research):
 *   SRTM 30m: best at 30m intervals  (0.2% closure on Sombrero)
 *   NED  10m: best at ~100m intervals (0.0% error on Big Sur)
 *
 * So we build one 30m sample set and use it for SRTM in full; for NED
 * we decimate it to every 3rd point (~90m spacing) before querying.
 */

import { haversineM } from './gpx';
import type { GpxPoint, GpxTrack } from './types';

const OPENTOPODATA_BASE = 'https://api.opentopodata.org/v1';
const BATCH_SIZE = 100;
const CONUS_BOUNDS = { minLat: 24, maxLat: 50, minLon: -125, maxLon: -66 };

export interface ElevationResult {
  track: GpxTrack;
  dataset: 'srtm30m' | 'ned10m';
  gainFt: number;
  lossFt: number;
  closureErr: number;
  divergenceWarning: boolean;
  warnings: string[];
}

// ── Sampling ────────────────────────────────────────────────────────────────

interface SamplePoint { idx: number; lat: number; lon: number; distM: number; }

function buildSamplePoints(points: GpxPoint[], intervalM: number): SamplePoint[] {
  const out: SamplePoint[] = [];
  let lastM = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i === 0 || i === points.length - 1 || p.distM - lastM >= intervalM) {
      out.push({ idx: i, lat: p.lat, lon: p.lon, distM: p.distM });
      lastM = p.distM;
    }
  }
  return out;
}

export function decimateSamples<T>(samples: T[], n: number): T[] {
  if (samples.length === 0 || n <= 1) return samples;
  const out: T[] = [];
  for (let i = 0; i < samples.length; i++) {
    if (i === 0 || i === samples.length - 1 || i % n === 0) out.push(samples[i]);
  }
  return out;
}

// ── OpenTopoData queries ─────────────────────────────────────────────────────

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function queryBatch(
  dataset: string,
  batch: Array<{ lat: number; lon: number }>,
  retries = 4,
): Promise<number[]> {
  const locations = batch.map(p => `${p.lat},${p.lon}`).join('|');
  const url = `${OPENTOPODATA_BASE}/${dataset}?locations=${locations}&interpolation=bilinear`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`OpenTopoData HTTP ${res.status} for ${dataset}`);
    const text = await res.text();
    if (!text.trim()) throw new Error('OpenTopoData empty response');
    const j = JSON.parse(text) as { status: string; results: Array<{ elevation: number | null }> };
    if (j.status !== 'OK') throw new Error(`OpenTopoData status: ${j.status}`);
    return j.results.map(r => r.elevation ?? NaN);
  }
  throw new Error('unreachable');
}

async function queryDataset(
  dataset: string,
  samples: SamplePoint[],
): Promise<number[]> {
  const eles: number[] = [];
  for (let i = 0; i < samples.length; i += BATCH_SIZE) {
    if (i > 0) await sleep(1100); // 1 req/s rate limit
    const batch = samples.slice(i, i + BATCH_SIZE);
    const result = await queryBatch(dataset, batch);
    eles.push(...result);
  }
  return eles;
}

// ── Gain/loss from an elevation series ──────────────────────────────────────

function gainLoss(eles: number[], thresholdM = 1.0): { gainFt: number; lossFt: number } {
  let gain = 0, loss = 0;
  for (let i = 1; i < eles.length; i++) {
    const d = eles[i] - eles[i - 1];
    if (d > thresholdM) gain += d;
    else if (d < -thresholdM) loss += -d;
  }
  return { gainFt: gain * 3.28084, lossFt: loss * 3.28084 };
}

function closureError(gainFt: number, lossFt: number): number {
  const avg = (gainFt + lossFt) / 2;
  return avg > 0 ? (Math.abs(gainFt - lossFt) / avg) * 100 : 0;
}

// ── Dataset selection ────────────────────────────────────────────────────────

export function selectDataset(
  srtm: { gainFt: number; lossFt: number; closureErr: number },
  ned: { gainFt: number; lossFt: number; closureErr: number } | null,
): 'srtm30m' | 'ned10m' {
  if (!ned) return 'srtm30m';
  // NED (LiDAR) is ground truth when internally consistent. Its failure mode —
  // reading bridge decks instead of road surface — shows up as HIGH closure
  // error (asymmetric gain/loss from crossing the deck). SRTM's failure mode
  // is radar scatter off urban infrastructure: it gives LOW closure error while
  // massively overcounting gain. So prefer NED unless its closure error is bad.
  if (ned.closureErr < 20) return 'ned10m';
  return 'srtm30m';
}

// ── Interpolation ────────────────────────────────────────────────────────────

function interpolateEles(
  allPoints: GpxPoint[],
  sampled: SamplePoint[],
  sampledEles: number[],
): number[] {
  const sampledWithEle = sampled.map((s, i) => ({ distM: s.distM, eleM: sampledEles[i] }));
  return allPoints.map(p => {
    let lo = 0, hi = sampledWithEle.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (sampledWithEle[mid].distM <= p.distM) lo = mid; else hi = mid;
    }
    const a = sampledWithEle[lo], b = sampledWithEle[hi];
    if (a.distM === b.distM) return a.eleM;
    const t = (p.distM - a.distM) / (b.distM - a.distM);
    return a.eleM + t * (b.eleM - a.eleM);
  });
}

// ── CONUS check ──────────────────────────────────────────────────────────────

function isInCONUS(points: GpxPoint[]): boolean {
  const sample = points[Math.floor(points.length / 2)];
  return (
    sample.lat >= CONUS_BOUNDS.minLat &&
    sample.lat <= CONUS_BOUNDS.maxLat &&
    sample.lon >= CONUS_BOUNDS.minLon &&
    sample.lon <= CONUS_BOUNDS.maxLon
  );
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function injectDemElevation(track: GpxTrack): Promise<ElevationResult> {
  const { points } = track;
  const warnings: string[] = [];

  // Build 30m sample grid (used for SRTM in full; NED gets every-3rd)
  const samples30m = buildSamplePoints(points, 30);
  const samplesNed = decimateSamples(samples30m, 3); // ~90m spacing

  // Query SRTM (all 30m samples)
  const srtmEles = await queryDataset('srtm30m', samples30m);
  const srtmInterp = interpolateEles(points, samples30m, srtmEles);
  const srtmGL = gainLoss(srtmInterp);
  const srtmClosure = closureError(srtmGL.gainFt, srtmGL.lossFt);

  // Query NED if in CONUS
  let nedResult: { gainFt: number; lossFt: number; closureErr: number } | null = null;
  let nedInterp: number[] | null = null;
  if (isInCONUS(points)) {
    const nedEles = await queryDataset('ned10m', samplesNed);
    const interp = interpolateEles(points, samplesNed, nedEles);
    const nedGL = gainLoss(interp);
    const nedClosure = closureError(nedGL.gainFt, nedGL.lossFt);
    nedResult = { gainFt: nedGL.gainFt, lossFt: nedGL.lossFt, closureErr: nedClosure };
    nedInterp = interp;
  }

  const chosen = selectDataset({ gainFt: srtmGL.gainFt, lossFt: srtmGL.lossFt, closureErr: srtmClosure }, nedResult);
  const chosenInterp = chosen === 'ned10m' && nedInterp ? nedInterp : srtmInterp;
  const chosenGL = chosen === 'ned10m' && nedResult ? nedResult : srtmGL;

  if (srtmClosure >= 10 && (!nedResult || nedResult.closureErr >= 10)) {
    warnings.push(`High loop-closure error (${srtmClosure.toFixed(1)}%). DEM data may be unreliable on this course — check for bridges or overpasses.`);
  }

  const divergenceWarning =
    nedResult !== null &&
    srtmGL.gainFt > 0 &&
    Math.abs(nedResult.gainFt - srtmGL.gainFt) / srtmGL.gainFt > 0.15;
  if (divergenceWarning) {
    warnings.push(`NED and SRTM gain estimates diverge by more than 15% (NED ${nedResult!.gainFt.toFixed(0)} ft vs SRTM ${srtmGL.gainFt.toFixed(0)} ft). SRTM may be overcounting urban infrastructure (bridges, buildings). NED is used when reliable.`);
  }

  // Inject demEleM on each point
  const newPoints: GpxPoint[] = points.map((p, i) => ({
    ...p,
    demEleM: chosenInterp[i],
  }));

  // Recompute DEM gain/loss at 1m threshold
  const demEles = newPoints.map(p => p.demEleM!);
  const demGL = gainLoss(demEles, 1.0);

  const newTrack: GpxTrack = {
    ...track,
    points: newPoints,
    demGainFt: Math.round(demGL.gainFt),
    demLossFt: Math.round(demGL.lossFt),
  };

  return {
    track: newTrack,
    dataset: chosen,
    gainFt: Math.round(demGL.gainFt),
    lossFt: Math.round(demGL.lossFt),
    closureErr: closureError(demGL.gainFt, demGL.lossFt),
    divergenceWarning,
    warnings,
  };
}
