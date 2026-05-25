/**
 * GPX course analysis, everything needed for the CoursePreview surface.
 *
 * Builds on parseGpx (lib/gpx.ts) to derive: per-segment grades & bearings,
 * per-km / per-mile splits, bounding box, out-and-back match score,
 * steepest segments, and the running narrative stats. All distances stay
 * in SI internally; converters live alongside the consumer.
 *
 * Calibration: parseGpx is invoked with smoothWindow=1 and a 2.0 m
 * threshold, that combination matches Strava's reported gain within
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
  /** Threshold-based gain in feet (2 m default, matches Strava). */
  gainFt: number;
  /** Threshold-based loss in feet. */
  lossFt: number;
  /** Raw (every positive Δ summed), useful as a noise floor display. */
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
  // O(n²), fine for typical GPX (<2k points). Sub-sample if a course ever exceeds that.
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

// ── Phase auto-naming ──────────────────────────────────────────────────
// Generates short, descriptive names for plan phases purely from the
// GPX shape, no curated registry needed. Replaces the curated labels
// from course-facts.ts at the consumer level: passing an
// auto-generated array always overrides whatever the saved plan
// stored, so the same label scheme applies to every race (registered
// or not).
//
// Heuristics, in order of priority:
//   • Net climb / drop ≥ 60 ft AND grade is meaningful → climb / descent
//   • Mean |grade| < 1 % → cruise / opening / finishing stretch
//   • Otherwise → rolling section
//   • First / last phase get prefixed with "Opening" / "Final"
//   • Single phase course → "Full course"
//
// Output is title-cased (e.g. "Opening climb", "The drop"). The poster
// CSS uppercases what it renders, so we don't need to all-caps here.

export interface PhaseShape {
  startMi: number;
  endMi: number;
  meanGradePct: number;
  netGainFt: number;
}

/** Build PhaseShape rows for an analysis given a list of phase ranges. */
export function summarizePhases(
  analysis: CourseAnalysis,
  phases: Array<{ start_mi: number; end_mi: number }>,
): PhaseShape[] {
  const { cumDistM, trkpts } = analysis;
  return phases.map(p => {
    const startM = p.start_mi * M_PER_MI;
    const endM = p.end_mi * M_PER_MI;
    // Find the trkpts bracketing the phase
    let lo = 0, hi = cumDistM.length - 1;
    for (let i = 0; i < cumDistM.length; i++) {
      if (cumDistM[i] >= startM) { lo = i; break; }
    }
    for (let i = cumDistM.length - 1; i >= 0; i--) {
      if (cumDistM[i] <= endM) { hi = i; break; }
    }
    if (hi < lo) hi = lo;
    let absGrade = 0, segs = 0;
    for (let i = lo + 1; i <= hi; i++) {
      const d = cumDistM[i] - cumDistM[i - 1];
      if (d <= 0) continue;
      absGrade += Math.abs(((trkpts[i][2] - trkpts[i - 1][2]) / d) * 100);
      segs++;
    }
    const meanGradePct = segs > 0 ? absGrade / segs : 0;
    const netGainFt = (trkpts[hi][2] - trkpts[lo][2]) * (1 / 0.3048);
    return {
      startMi: p.start_mi,
      endMi: p.end_mi,
      meanGradePct,
      netGainFt,
    };
  });
}

export function autoNamePhases(
  analysis: CourseAnalysis,
  phases: Array<{ start_mi: number; end_mi: number }>,
): string[] {
  const shapes = summarizePhases(analysis, phases);
  if (shapes.length === 0) return [];
  if (shapes.length === 1) return ['Full course'];

  const raw = shapes.map((s, i) => {
    const isFirst = i === 0;
    const isLast = i === shapes.length - 1;
    const lengthMi = s.endMi - s.startMi;
    const flat = s.meanGradePct < 1.0 && Math.abs(s.netGainFt) < 40;
    const climb = s.netGainFt > 60 && s.meanGradePct > 1.0;
    const drop = s.netGainFt < -60 && s.meanGradePct > 1.0;
    const steepClimb = s.netGainFt > 100 && s.meanGradePct > 4.0;
    const steepDrop = s.netGainFt < -100 && s.meanGradePct > 4.0;
    const wall = lengthMi < 1 && s.meanGradePct > 5.0;

    if (wall && climb) return 'Wall climb';
    if (wall && drop) return 'Quick drop';
    if (steepClimb) return isFirst ? 'Opening climb' : isLast ? 'Final climb' : 'The climb';
    if (steepDrop)  return isLast ? 'Final descent' : 'The drop';
    if (climb)      return isFirst ? 'Opening climb' : isLast ? 'Final push' : 'Rolling climb';
    if (drop)       return isLast ? 'Closing descent' : 'Long descent';
    if (flat)       return isFirst ? 'Opening miles' : isLast ? 'Finishing stretch' : 'Cruise';
    // Mixed / mild rolling, keep base short so positional prefixes
    // ("Early Rolling / Mid Rolling / Late Rolling") still read cleanly.
    return isFirst ? 'Warm-up' : isLast ? 'Final stretch' : 'Rolling';
  });

  return dedupeRunsWithPosition(raw);
}

/** When N consecutive phases share an identical auto-name, prefix each
 *  with a position descriptor so the legend doesn't read "Rolling /
 *  Rolling / Rolling / Rolling". 2 → Early / Late, 3 → Early / Mid /
 *  Late, 4 → Opening / Early / Late / Closing, 5+ → numbered. */
function dedupeRunsWithPosition(names: string[]): string[] {
  const out = names.slice();
  let i = 0;
  while (i < out.length) {
    const base = out[i];
    let j = i;
    while (j + 1 < out.length && out[j + 1] === base) j++;
    const run = j - i + 1;
    if (run > 1) {
      const lower = base.toLowerCase();
      const positional =
        run === 2 ? [`Early ${lower}`, `Late ${lower}`] :
        run === 3 ? [`Early ${lower}`, `Mid ${lower}`, `Late ${lower}`] :
        // 4+ phases sharing a label → neutral numbering. Avoids
        // collisions with neighbour phases (e.g. "Opening rolling"
        // colliding with "Opening miles" on the previous slot).
        Array.from({ length: run }, (_, k) => `${base} ${k + 1}`);
      for (let k = 0; k < run; k++) out[i + k] = positional[k];
    }
    i = j + 1;
  }
  return out;
}

// ── Continuous grade color (lerps between bucket anchors) ──────────────
// `gradeColor` is fine for the legend (shows discrete buckets) but the
// polyline rendered with it has hard color seams whenever a segment's
// grade crosses a bucket edge, e.g. 4.95 % → 5.05 % flips yellow → orange
// in a single segment. `gradeColorContinuous` interpolates linearly between
// adjacent anchor colors so a 4.95 % segment is almost yellow, a 5.05 %
// segment is almost orange, and the polyline visually fades between them.
// Anchor positions match the bucket *centers* so the legend swatch and
// the polyline at the same grade render identically.

const GRADE_ANCHORS: Array<{ at: number; rgb: [number, number, number] }> = [
  { at: -10, rgb: [30,  58, 138] }, // < -8 %
  { at: -6.5, rgb: [37,  99, 235] }, // -8 to -5 %
  { at: -4,  rgb: [59, 130, 246] }, // -5 to -3 %
  { at: -2,  rgb: [96, 165, 250] }, // -3 to -1 %
  { at:  0,  rgb: [16, 185, 129] }, // flat ±1 %
  { at:  2,  rgb: [132, 204,  22] }, // 1 to 3 %
  { at:  4,  rgb: [234, 179,   8] }, // 3 to 5 %
  { at:  6.5, rgb: [249, 115,  22] }, // 5 to 8 %
  { at: 10,  rgb: [220,  38,  38] }, // > 8 %
];

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

export function gradeColorContinuous(gradePct: number): string {
  if (gradePct <= GRADE_ANCHORS[0].at) {
    const [r, g, b] = GRADE_ANCHORS[0].rgb;
    return `rgb(${r},${g},${b})`;
  }
  const last = GRADE_ANCHORS[GRADE_ANCHORS.length - 1];
  if (gradePct >= last.at) {
    const [r, g, b] = last.rgb;
    return `rgb(${r},${g},${b})`;
  }
  for (let i = 0; i < GRADE_ANCHORS.length - 1; i++) {
    const a = GRADE_ANCHORS[i], n = GRADE_ANCHORS[i + 1];
    if (gradePct >= a.at && gradePct < n.at) {
      const t = (gradePct - a.at) / (n.at - a.at);
      const r = Math.round(lerp(a.rgb[0], n.rgb[0], t));
      const g = Math.round(lerp(a.rgb[1], n.rgb[1], t));
      const b = Math.round(lerp(a.rgb[2], n.rgb[2], t));
      return `rgb(${r},${g},${b})`;
    }
  }
  const [r, g, b] = last.rgb;
  return `rgb(${r},${g},${b})`;
}
