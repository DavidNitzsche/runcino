/**
 * lib/runs/elev-from-gps.ts · derive elevation gain from a GPS polyline
 * by querying Open-Meteo's free elevation API.
 *
 * 2026-06-04 · David's QC: Run Detail showed "NO DATA" on ELEV GAIN.
 * Root cause:
 *   · Faff watch app's WatchCompletion payload has zero elev fields
 *   · iPhone HealthKit importer's payload doesn't send elev_gain_ft
 *   · Strava ingest gets it for free (their server enriches), but the
 *     two native paths David uses don't
 *
 * Server-side fix: when the run lands without an elev value but DOES
 * carry a routePolyline (the watch sends it · we render the map from
 * it), sample the polyline at a coarse stride, ask Open-Meteo for
 * elevation at each sample, and sum the positive deltas. Open-Meteo's
 * elevation endpoint is free, key-less, and tolerates 100 coordinates
 * per request.
 *
 * Limitations:
 *   · Coarse · ~100 samples over a 7-mile run is ~50m spacing. Loses
 *     micro-undulations (overpasses, switchbacks). Underestimates gain
 *     vs a barometer-equipped watch · acceptable as a fallback.
 *   · Uses 90m SRTM DEM under the hood · accuracy ±5-10m per reading.
 *   · No timeout-resilience here · caller must handle the promise.
 *
 * Doctrine: not part of any research file · pragmatic backfill for a
 * canonical-data gap. When the iPhone/watch apps start shipping elev
 * natively (Faff watch app TODO + iPhone HK importer TODO in
 * docs/IPHONE_SYNC_LEDGER.md), the device-reported value should be
 * preferred over this GPS-derived estimate.
 */
import { decodePolyline } from '@/lib/route/polyline';

const ENDPOINT = 'https://api.open-meteo.com/v1/elevation';
const MAX_POINTS_PER_REQUEST = 100;
const TARGET_SAMPLE_COUNT = 100;

export interface GpsElevResult {
  /** Positive elevation gain in feet, rounded to nearest integer. */
  value: number;
  /** Always 'gps_derived' · provenance stamp callers fold into the row. */
  source: 'gps_derived';
}

/**
 * Take a Google-encoded polyline, return positive elevation gain in ft.
 * Returns null on any failure (empty polyline, API error, too few
 * points to be meaningful). Callers should fall back to whatever they
 * had before · null means "couldn't enrich, keep whatever was there."
 */
export async function elevFromPolyline(
  polyline: string | null | undefined,
): Promise<GpsElevResult | null> {
  if (!polyline || typeof polyline !== 'string') return null;
  let points: Array<[number, number]>;
  try {
    points = decodePolyline(polyline);
  } catch {
    return null;
  }
  if (points.length < 4) return null;

  // Down-sample to TARGET_SAMPLE_COUNT evenly-spaced points.
  // Polylines come back at variable density depending on GPS sample rate
  // and the encoder's tolerance · 7 miles of running ≈ 300-700 points.
  // 100 samples puts us at ~100m spacing, which captures real climbs +
  // descents without amplifying GPS noise at the meter scale.
  const sampled = downsample(points, TARGET_SAMPLE_COUNT);
  if (sampled.length < 4) return null;

  // Open-Meteo caps at 100 coordinates per request. With our
  // TARGET_SAMPLE_COUNT = 100 this is always one request.
  const elevations: number[] = [];
  for (let i = 0; i < sampled.length; i += MAX_POINTS_PER_REQUEST) {
    const batch = sampled.slice(i, i + MAX_POINTS_PER_REQUEST);
    const lats = batch.map((p) => p[0]).join(',');
    const lons = batch.map((p) => p[1]).join(',');
    const url = `${ENDPOINT}?latitude=${lats}&longitude=${lons}`;
    let json: unknown;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        // Open-Meteo is usually < 500ms · cap at 5s so a slow upstream
        // doesn't stall the entire ingest path.
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      json = await res.json();
    } catch {
      return null;
    }
    const elevs = extractElevationMeters(json);
    if (!elevs || elevs.length === 0) return null;
    elevations.push(...elevs);
  }

  if (elevations.length < 4) return null;

  // Sum positive deltas. Drop deltas smaller than 0.5m as GPS / DEM
  // noise · without this even a flat run accumulates 50-100m of
  // fictional gain from oscillation.
  let gainM = 0;
  for (let i = 1; i < elevations.length; i++) {
    const delta = elevations[i] - elevations[i - 1];
    if (delta >= 0.5) gainM += delta;
  }
  const gainFt = gainM * 3.28084;
  if (gainFt < 1) return { value: 0, source: 'gps_derived' };
  return { value: Math.round(gainFt), source: 'gps_derived' };
}

/**
 * Open-Meteo returns either `{elevation: number[]}` (multi-coord query)
 * or `{elevation: number}` (single-coord query). Extract a flat array
 * either way. Returns null on unexpected shape.
 */
function extractElevationMeters(json: unknown): number[] | null {
  if (!json || typeof json !== 'object') return null;
  const raw = (json as { elevation?: unknown }).elevation;
  if (raw == null) return null;
  if (typeof raw === 'number') return [raw];
  if (!Array.isArray(raw)) return null;
  const out: number[] = [];
  for (const v of raw) {
    const n = Number(v);
    if (!isFinite(n)) continue;
    out.push(n);
  }
  return out;
}

/**
 * Evenly subsample an array of points down to target count. When the
 * input is already <= target, returns as-is.
 */
function downsample<T>(arr: T[], target: number): T[] {
  if (arr.length <= target) return arr.slice();
  const step = (arr.length - 1) / (target - 1);
  const out: T[] = [];
  for (let i = 0; i < target; i++) {
    out.push(arr[Math.round(i * step)]);
  }
  return out;
}
