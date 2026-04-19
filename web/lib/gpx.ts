/**
 * GPX parser.
 *
 * Reads a GPX 1.1 file, extracts trackpoints with lat/lon/elevation,
 * computes cumulative distance via haversine, and applies a 3-point
 * moving-average smooth to elevation (raw GPS altitude typically
 * jitters by ±3m even at rest).
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

function sumGainLossFt(points: GpxPoint[], key: 'eleM'): [number, number] {
  let gain = 0, loss = 0;
  for (let i = 1; i < points.length; i++) {
    const d = (points[i][key] - points[i - 1][key]) * FT_PER_M;
    if (d > 0) gain += d; else loss -= d;
  }
  return [gain, loss];
}

export interface ParseOptions {
  /** Moving-average window size. Default 3. Set to 1 to disable smoothing. */
  smoothWindow?: number;
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

  // Smooth in place (default 3-point window)
  const window = opts.smoothWindow ?? 3;
  if (window >= 3) {
    // Apply window-sized moving average
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

  const [smGain, smLoss] = sumGainLossFt(points, 'eleM');

  return {
    points,
    totalDistanceM: dist,
    rawGainFt: rawGain,
    rawLossFt: rawLoss,
    smoothedGainFt: smGain,
    smoothedLossFt: smLoss,
  };
}
