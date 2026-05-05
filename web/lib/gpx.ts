/**
 * GPX parser.
 *
 * Reads a GPX 1.1 file, extracts trackpoints with lat/lon/elevation,
 * computes cumulative distance via haversine, and produces realistic
 * elevation gain/loss numbers.
 *
 * Naïve gain summing (every positive delta) accumulates phantom climb
 * from GPS jitter — typical handheld GPS reports ±3m altitude noise
 * even at rest, which on a 13mi run can compound into 200+ ft of
 * fake elevation gain. Strava (and pretty much every serious tracker)
 * counters this with two passes:
 *
 *   1. Smooth the altitude series with a moving average (we use 9
 *      points by default — wide enough to flatten sample-to-sample
 *      jitter, narrow enough to preserve real climbs and descents).
 *   2. Threshold the gain/loss summing: maintain a "pivot" altitude
 *      and only count a move once the current altitude has drifted
 *      more than `thresholdM` from the pivot. Sub-threshold wiggles
 *      stay un-counted; once a real climb pushes past the threshold,
 *      the full delta gets recorded and the pivot resets.
 *
 * The result lands within a few percent of Strava's own number for
 * the same trace.
 */

import { XMLParser } from 'fast-xml-parser';
import { FT_PER_M } from './time';
import type { GpxPoint, GpxTrack } from './types';

const EARTH_R_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in meters. Flat-earth would also work at marathon scale
 *  but haversine costs nothing and is future-proof for ultras. */
export function haversineM(
  aLat: number, aLon: number,
  bLat: number, bLon: number
): number {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.sqrt(h));
}

/** 3-point moving average applied to eleM in place, tail handled. */
export function smoothElevation(points: GpxPoint[]): void {
  if (points.length < 3) return;
  const copy = points.map(p => p.eleM);
  for (let i = 1; i < points.length - 1; i++) {
    points[i].eleM = (copy[i - 1] + copy[i] + copy[i + 1]) / 3;
  }
}

/** Naïve sum of every positive (gain) and negative (loss) per-sample
 *  elevation delta. Use this only as the rawGainFt baseline — it
 *  systematically over-counts because GPS altitude jitter at every
 *  sample contributes phantom climb. */
function sumGainLossFt(points: GpxPoint[], key: 'eleM'): [number, number] {
  let gain = 0, loss = 0;
  for (let i = 1; i < points.length; i++) {
    const d = (points[i][key] - points[i - 1][key]) * FT_PER_M;
    if (d > 0) gain += d; else loss -= d;
  }
  return [gain, loss];
}

/** Threshold-based gain/loss summer. Maintains a pivot altitude and
 *  only records a delta once the current altitude has drifted more
 *  than `thresholdM` from the pivot. Once recorded, the pivot resets.
 *  Output is in feet. */
export function thresholdedGainLossFt(points: GpxPoint[], thresholdM = 1.0): [number, number] {
  if (points.length < 2) return [0, 0];
  let gain = 0, loss = 0;
  let pivot = points[0].eleM;
  for (let i = 1; i < points.length; i++) {
    const cur = points[i].eleM;
    const delta = cur - pivot;
    if (Math.abs(delta) < thresholdM) continue;
    if (delta > 0) gain += delta * FT_PER_M;
    else loss += (-delta) * FT_PER_M;
    pivot = cur;
  }
  return [gain, loss];
}

export interface ParseOptions {
  /** Moving-average window size. Default 5 (was 9 — too aggressive,
   *  flattened real 30-60s climbs). Set to 1 to disable smoothing.
   *  A 5-pt window over ~5s/sample data spans ~25s of running —
   *  enough to tame jitter, narrow enough to preserve real terrain. */
  smoothWindow?: number;
  /** Pivot threshold for the gain/loss summing pass, in meters.
   *  Default 1.0m (~3.3ft) — calibrated against Strava's own
   *  reported gain on the same traces. 1.5m was over-filtering. */
  gainThresholdM?: number;
}

export function parseGpx(xml: string, opts: ParseOptions = {}): GpxTrack {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: true,
    isArray: (name) => name === 'trkpt' || name === 'trk' || name === 'trkseg',
  });
  const doc = parser.parse(xml);

  if (doc.gpx === undefined) throw new Error('Not a GPX file: missing <gpx>');

  const tracks = doc.gpx.trk || [];
  const flat: Array<{ lat: number; lon: number; eleM: number }> = [];
  for (const trk of tracks) {
    const segs = trk.trkseg || [];
    for (const seg of segs) {
      const pts = seg.trkpt || [];
      for (const p of pts) {
        const lat = Number(p['@_lat']);
        const lon = Number(p['@_lon']);
        const ele = p.ele !== undefined ? Number(p.ele) : 0;
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          flat.push({ lat, lon, eleM: ele });
        }
      }
    }
  }

  if (flat.length < 2) {
    throw new Error(`GPX has too few points: ${flat.length}`);
  }

  // Compute cumulative distance
  const points: GpxPoint[] = [];
  let dist = 0;
  for (let i = 0; i < flat.length; i++) {
    if (i > 0) {
      dist += haversineM(
        flat[i - 1].lat, flat[i - 1].lon,
        flat[i].lat, flat[i].lon,
      );
    }
    points.push({
      lat: flat[i].lat,
      lon: flat[i].lon,
      eleM: flat[i].eleM,
      distM: dist,
    });
  }

  const [rawGain, rawLoss] = sumGainLossFt(points, 'eleM');

  // Smooth in place (default 5-point window — calibrated against
  // Strava's own reported gain. 9-pt was over-smoothing real climbs).
  const window = opts.smoothWindow ?? 5;
  if (window >= 3) {
    const src = points.map(p => p.eleM);
    const half = Math.floor(window / 2);
    for (let i = 0; i < points.length; i++) {
      const lo = Math.max(0, i - half);
      const hi = Math.min(points.length - 1, i + half);
      let sum = 0;
      for (let j = lo; j <= hi; j++) sum += src[j];
      points[i].eleM = sum / (hi - lo + 1);
    }
  }

  // Threshold-based gain/loss for the "smoothed" output — calibrated
  // against Strava's own reported gain. The naïve sum-every-delta
  // version stays in `rawGainFt` for reference.
  const [smGain, smLoss] = thresholdedGainLossFt(points, opts.gainThresholdM ?? 1.0);

  return {
    points,
    totalDistanceM: dist,
    rawGainFt: rawGain,
    rawLossFt: rawLoss,
    smoothedGainFt: smGain,
    smoothedLossFt: smLoss,
  };
}
