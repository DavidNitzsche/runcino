/**
 * DEM elevation correction via USGS 3DEP Elevation Point Query Service.
 *
 * GPS-recorded elevation systematically underreports steep terrain by 30-50%.
 * This replaces GPS elevation with ground-truth values from the USGS national
 * terrain model, same source Garmin Connect and Strava use post-run.
 *
 * We sample 60 evenly-spaced points from the track, query in parallel batches
 * of 10, then linear-interpolate elevation for all remaining points.
 */

import type { GpxPoint } from './types';

const USGS_URL = 'https://epqs.nationalmap.gov/v1/json';
const SAMPLE_N = 60;
const BATCH_SIZE = 10;

/** USGS 3DEP, 1m resolution, US only. Best source for US courses. */
async function queryUsgsElevationFt(lat: number, lon: number): Promise<number | null> {
  try {
    const url = `${USGS_URL}?x=${lon}&y=${lat}&wkid=4326&units=Feet&includeDate=false`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    const val = parseFloat(data?.value ?? data?.properties?.value ?? '');
    return Number.isFinite(val) && val > -1000 ? val : null;
  } catch {
    return null;
  }
}

/** Open-Topo-Data SRTM, 30m resolution, global. Fallback for non-US courses. */
async function batchQuerySrtm(pts: GpxPoint[]): Promise<(number | null)[]> {
  try {
    const locations = pts.map(p => `${p.lat},${p.lon}`).join('|');
    const res = await fetch(`https://api.opentopodata.org/v1/srtm30m?locations=${locations}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return pts.map(() => null);
    const data = await res.json();
    return (data.results as Array<{ elevation: number | null }>).map(r =>
      r.elevation !== null && Number.isFinite(r.elevation) ? r.elevation * 3.28084 : null
    );
  } catch {
    return pts.map(() => null);
  }
}

async function batchQuery(pts: GpxPoint[]): Promise<(number | null)[]> {
  // Try USGS 3DEP first (US only, 1m resolution)
  const usgsResults: (number | null)[] = [];
  for (let i = 0; i < pts.length; i += BATCH_SIZE) {
    const batch = pts.slice(i, i + BATCH_SIZE);
    const elevs = await Promise.all(batch.map(p => queryUsgsElevationFt(p.lat, p.lon)));
    usgsResults.push(...elevs);
  }

  const usgsHits = usgsResults.filter(v => v !== null).length;
  if (usgsHits >= pts.length / 2) return usgsResults;

  // Fall back to Open-Topo-Data SRTM (global)
  return batchQuerySrtm(pts);
}

function downsampleIndices(totalLen: number, n: number): number[] {
  if (totalLen <= n) return Array.from({ length: totalLen }, (_, i) => i);
  const indices: number[] = [];
  const step = (totalLen - 1) / (n - 1);
  for (let i = 0; i < n - 1; i++) indices.push(Math.round(i * step));
  indices.push(totalLen - 1);
  return [...new Set(indices)].sort((a, b) => a - b);
}

/**
 * Returns a new points array with GPS elevation replaced by USGS DEM elevation.
 * Falls back to original GPS elevation if any USGS query fails.
 * Elevation is converted back to meters to stay consistent with GpxPoint.eleM.
 */
export async function correctElevations(points: GpxPoint[]): Promise<{ points: GpxPoint[]; corrected: boolean }> {
  if (points.length < 3) return { points, corrected: false };

  const sampleIdxs = downsampleIndices(points.length, SAMPLE_N);
  const samplePts = sampleIdxs.map(i => points[i]);

  let demElevsFt: (number | null)[];
  try {
    demElevsFt = await batchQuery(samplePts);
  } catch {
    return { points, corrected: false };
  }

  // If more than half failed, bail, USGS may be down
  const successCount = demElevsFt.filter(v => v !== null).length;
  if (successCount < samplePts.length / 2) {
    return { points, corrected: false };
  }

  // Build a lookup of index → DEM elevation (ft)
  const anchorMap = new Map<number, number>();
  for (let i = 0; i < sampleIdxs.length; i++) {
    const elev = demElevsFt[i];
    if (elev !== null) anchorMap.set(sampleIdxs[i], elev);
  }

  // Linear interpolate between known anchors for all points
  const correctedPoints: GpxPoint[] = points.map((pt, idx) => {
    if (anchorMap.has(idx)) {
      return { ...pt, eleM: anchorMap.get(idx)! / 3.28084 };
    }
    // Find nearest anchors before and after
    const anchors = [...anchorMap.entries()].sort((a, b) => a[0] - b[0]);
    const before = anchors.filter(([i]) => i <= idx).at(-1);
    const after = anchors.find(([i]) => i > idx);
    if (!before) return { ...pt, eleM: after![1] / 3.28084 };
    if (!after) return { ...pt, eleM: before[1] / 3.28084 };
    const t = (idx - before[0]) / (after[0] - before[0]);
    const interpFt = before[1] + t * (after[1] - before[1]);
    return { ...pt, eleM: interpFt / 3.28084 };
  });

  return { points: correctedPoints, corrected: true };
}
