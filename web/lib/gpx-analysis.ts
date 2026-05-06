/**
 * GPX course analysis — everything needed for the CoursePreview surface.
 *
 * Builds on parseGpx (lib/gpx.ts) to derive: per-segment grades & bearings,
 * per-km / per-mile splits, bounding box, out-and-back match score,
 * steepest segments, and the running narrative stats. All distances stay
 * in SI internally; converters live alongside the consumer.
 *
 * Calibration: parseGpx is invoked with smoothWindow=1 and a 2.0 m
 * threshold — that combination matches Strava's reported gain within
 * ~2% on StravaGPX-creator exports (Malibu Half: 237 ft computed vs
 * 232 ft Strava). Other callers of parseGpx that want different
 * smoothing/thresholding pass their own opts.
 */
import { parseGpx, haversineM } from './gpx';
import type { GpxTrack } from './types';

export interface CourseAnalysisSplit {
  /** 1-based index of the split (km 1, km 2, …). */
  idx: number;
  startDistM: number;
  endDistM: number;
  lengthM: number;
  startEleM: number;
  endEleM: number;
  deltaEleM: number;
}

export interface CourseAnalysisStats {
  totalDistM: number;
  /** Threshold-based gain in feet (2 m default — matches Strava). */
  gainFt: number;
  /** Threshold-based loss in feet. */
  lossFt: number;
  /** Raw (every positive Δ summed) — useful as a noise floor display. */
  rawGainFt: number;
  rawLossFt: number;
  minEleM: number;
  maxEleM: number;
  minEleIdx: number;
  maxEleIdx: number;
  numPoints: number;
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  center: [number, number];
  bboxWidthM: number;
  bboxHeightM: number;
  /** Crow-fly distance start point ↔ end point. */
  startToEndM: number;
  /** Index of the trackpoint farthest from the start (turnaround for OAB). */
  turnIdx: number;
  /** Crow-fly distance from start to that farthest point. */
  maxFromStartM: number;
  /** Steepest signed grades along the route, in percent. */
  maxUpGradePct: number;
  maxDownGradePct: number;
  maxUpIdx: number;
  maxDownIdx: number;
  /** % of return points (after turnIdx) that lie within 10 m of an outbound point.
   *  >75 → genuine out-and-back; close to startToEndM → loop; otherwise point-to-point. */
  oabScorePct: number;
  /** Mean of |grade| across all segments. */
  meanGradePct: number;
}

export interface CourseAnalysis {
  /** Flat array of [lat, lon, eleM] triples for compact JSON shape. */
  trkpts: Array<[number, number, number]>;
  /** cumDistM[i] = haversine distance from start to point i. cumDistM.length === trkpts.length. */
  cumDistM: number[];
  /** segDistsM[i] = haversine distance from point i to point i+1. length n-1. */
  segDistsM: number[];
  /** gradesPct[i] = signed % grade of segment i (point i → i+1). length n-1. */
  gradesPct: number[];
  /** bearingsDeg[i] = compass bearing 0–360 of segment i. length n-1. */
  bearingsDeg: number[];
  kmSplits: CourseAnalysisSplit[];
  mileSplits: CourseAnalysisSplit[];
  stats: CourseAnalysisStats;
  /** Convenience copy of the parsed track for callers that want it. */
  track: GpxTrack;
}

const M_PER_KM = 1000;
const M_PER_MI = 1609.344;

/** Compass bearing from a → b (0 = north, 90 = east). */
function bearingDeg(
  aLat: number, aLon: number,
  bLat: number, bLon: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const dLon = toRad(bLon - aLon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Linear interp of elevation at a target cumulative distance. */
function eleAtDist(
  cumDistM: number[],
  eleM: number[],
  target: number,
): number {
  if (target <= 0) return eleM[0];
  const last = cumDistM[cumDistM.length - 1];
  if (target >= last) return eleM[eleM.length - 1];
  let lo = 0, hi = cumDistM.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >>> 1;
    if (cumDistM[mid] <= target) lo = mid;
    else hi = mid;
  }
  const span = cumDistM[hi] - cumDistM[lo];
  const t = span > 0 ? (target - cumDistM[lo]) / span : 0;
  return eleM[lo] + t * (eleM[hi] - eleM[lo]);
}

function buildSplits(
  cumDistM: number[],
  eleM: number[],
  unitM: number,
  totalDistM: number,
): CourseAnalysisSplit[] {
  if (totalDistM <= 0) return [];
  const out: CourseAnalysisSplit[] = [];
  const n = Math.ceil(totalDistM / unitM);
  let prevEle = eleAtDist(cumDistM, eleM, 0);
  for (let i = 1; i <= n; i++) {
    const startD = (i - 1) * unitM;
    const endD = Math.min(i * unitM, totalDistM);
    const endEle = eleAtDist(cumDistM, eleM, endD);
    out.push({
      idx: i,
      startDistM: startD,
      endDistM: endD,
      lengthM: endD - startD,
      startEleM: prevEle,
      endEleM: endEle,
      deltaEleM: endEle - prevEle,
    });
    prevEle = endEle;
    if (endD >= totalDistM) break;
  }
  return out;
}

export function analyzeGpx(gpxText: string): CourseAnalysis {
  // Strava-calibrated defaults: no smoothing, 2.0 m threshold.
  const track = parseGpx(gpxText, { smoothWindow: 1, gainThresholdM: 2.0 });
  const pts = track.points;
  const n = pts.length;
  if (n < 2) {
    throw new Error(`GPX has too few points: ${n}`);
  }

  const trkpts: Array<[number, number, number]> = pts.map(p => [p.lat, p.lon, p.eleM]);
  const cumDistM = pts.map(p => p.distM);
  const eleM = pts.map(p => p.eleM);

  const segDistsM: number[] = new Array(n - 1);
  const gradesPct: number[] = new Array(n - 1);
  const bearingsDeg: number[] = new Array(n - 1);
  let absGradeSum = 0;
  let maxUpGradePct = -Infinity, maxDownGradePct = Infinity;
  let maxUpIdx = 0, maxDownIdx = 0;

  for (let i = 1; i < n; i++) {
    const d = cumDistM[i] - cumDistM[i - 1];
    segDistsM[i - 1] = d;
    const dEle = pts[i].eleM - pts[i - 1].eleM;
    const g = d > 0 ? (dEle / d) * 100 : 0;
    gradesPct[i - 1] = g;
    bearingsDeg[i - 1] = bearingDeg(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
    absGradeSum += Math.abs(g);
    if (g > maxUpGradePct)   { maxUpGradePct = g;   maxUpIdx = i - 1; }
    if (g < maxDownGradePct) { maxDownGradePct = g; maxDownIdx = i - 1; }
  }
  const meanGradePct = (n - 1) > 0 ? absGradeSum / (n - 1) : 0;

  // Min/max elevation indices
  let minEleM = pts[0].eleM, maxEleM = pts[0].eleM;
  let minEleIdx = 0, maxEleIdx = 0;
  for (let i = 1; i < n; i++) {
    if (pts[i].eleM < minEleM) { minEleM = pts[i].eleM; minEleIdx = i; }
    if (pts[i].eleM > maxEleM) { maxEleM = pts[i].eleM; maxEleIdx = i; }
  }

  // Bounding box
  let minLat = pts[0].lat, maxLat = pts[0].lat;
  let minLon = pts[0].lon, maxLon = pts[0].lon;
  for (let i = 1; i < n; i++) {
    if (pts[i].lat < minLat) minLat = pts[i].lat;
    if (pts[i].lat > maxLat) maxLat = pts[i].lat;
    if (pts[i].lon < minLon) minLon = pts[i].lon;
    if (pts[i].lon > maxLon) maxLon = pts[i].lon;
  }
  const center: [number, number] = [(minLat + maxLat) / 2, (minLon + maxLon) / 2];
  const bboxWidthM  = haversineM(center[0], minLon, center[0], maxLon);
  const bboxHeightM = haversineM(minLat, center[1], maxLat, center[1]);

  // Start/end + turnaround (farthest crow-fly point from start)
  const startToEndM = haversineM(pts[0].lat, pts[0].lon, pts[n - 1].lat, pts[n - 1].lon);
  let turnIdx = 0, maxFromStartM = 0;
  for (let i = 1; i < n; i++) {
    const d = haversineM(pts[0].lat, pts[0].lon, pts[i].lat, pts[i].lon);
    if (d > maxFromStartM) { maxFromStartM = d; turnIdx = i; }
  }

  // Out-and-back match score: % of return points within 10 m of any outbound point.
  // O(n²) — fine for typical GPX (<2k points). Sub-sample if a course ever exceeds that.
  let oabScorePct = 0;
  const ret = n - turnIdx;
  if (ret > 0) {
    let matches = 0;
    for (let j = turnIdx; j < n; j++) {
      for (let i = 0; i <= turnIdx; i++) {
        if (haversineM(pts[i].lat, pts[i].lon, pts[j].lat, pts[j].lon) < 10) {
          matches++;
          break;
        }
      }
    }
    oabScorePct = (matches / ret) * 100;
  }

  const totalDistM = track.totalDistanceM;
  const kmSplits   = buildSplits(cumDistM, eleM, M_PER_KM, totalDistM);
  const mileSplits = buildSplits(cumDistM, eleM, M_PER_MI, totalDistM);

  const stats: CourseAnalysisStats = {
    totalDistM,
    gainFt: track.smoothedGainFt,
    lossFt: track.smoothedLossFt,
    rawGainFt: track.rawGainFt,
    rawLossFt: track.rawLossFt,
    minEleM, maxEleM, minEleIdx, maxEleIdx,
    numPoints: n,
    bbox: { minLat, maxLat, minLon, maxLon },
    center,
    bboxWidthM, bboxHeightM,
    startToEndM,
    turnIdx, maxFromStartM,
    maxUpGradePct: Number.isFinite(maxUpGradePct) ? maxUpGradePct : 0,
    maxDownGradePct: Number.isFinite(maxDownGradePct) ? maxDownGradePct : 0,
    maxUpIdx, maxDownIdx,
    oabScorePct, meanGradePct,
  };

  return { trkpts, cumDistM, segDistsM, gradesPct, bearingsDeg, kmSplits, mileSplits, stats, track };
}

/** Color stops for grade-tinted polylines + the legend on the map. */
export const GRADE_COLORS: Array<{ max: number; color: string; label: string }> = [
  { max: -8, color: '#1e3a8a', label: '< -8%' },
  { max: -5, color: '#2563eb', label: '-8 to -5%' },
  { max: -3, color: '#3b82f6', label: '-5 to -3%' },
  { max: -1, color: '#60a5fa', label: '-3 to -1%' },
  { max:  1, color: '#10b981', label: 'flat ±1%' },
  { max:  3, color: '#84cc16', label: '1 to 3%' },
  { max:  5, color: '#eab308', label: '3 to 5%' },
  { max:  8, color: '#f97316', label: '5 to 8%' },
  { max: Infinity, color: '#dc2626', label: '> 8%' },
];

export function gradeColor(gradePct: number): string {
  for (const stop of GRADE_COLORS) {
    if (gradePct < stop.max) return stop.color;
  }
  return GRADE_COLORS[GRADE_COLORS.length - 1].color;
}
