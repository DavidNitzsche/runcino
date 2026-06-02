/**
 * GET /api/admin/audit-weather?date=YYYY-MM-DD
 * GET /api/admin/audit-weather?id=<runs.id>
 *
 * READ-ONLY diagnostic · audit the full weather pipeline for a run.
 * Surfaces every layer where the temp could be wrong so we can stop
 * band-aiding and actually see what's broken.
 *
 * Per CLAUDE.md operational doctrine · agent-built, scoped to caller,
 * non-mutating. Self-execute, surface the result, don't bury it.
 *
 * Returns:
 *
 *   {
 *     userId,
 *     query: { date, id },
 *     rows: [{
 *       id, source, startLocal, mergedIntoId,
 *       startLat, startLng, durationSec,
 *       storedWeather: { temp_f, temp_f_start, temp_f_end, temp_f_peak,
 *                         source, fetched_at, conditions, ... },
 *       storedTempF, weather_enriched_at,
 *       autoCorrectVerdict: {
 *         willFire: bool,
 *         reasons: [list of conditions and their values]
 *       },
 *       liveOpenMeteoForecast: { temp_f_start, temp_f_end, temp_f_peak,
 *                                conditions, source: 'forecast' },
 *       liveOpenMeteoArchive: { temp_f_start, ... source: 'archive' }
 *     }]
 *   }
 *
 * The auto-correct verdict tells us why the lazy-enrich path isn't
 * triggering. The live forecast/archive comparison tells us what
 * Open-Meteo would return RIGHT NOW for the run's coords + time.
 * If forecast and archive disagree, that's the lag issue. If forecast
 * also shows 57°F, the bug isn't in the host pick.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { toUtcIso } from '@/lib/runs/normalize-time';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface RunRow {
  id: string;
  data: Record<string, any>;
  weather_enriched_at: string | null;
}

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const url = new URL(req.url);
  const date = url.searchParams.get('date');
  const idParam = url.searchParams.get('id');
  if (!date && !idParam) {
    return NextResponse.json({
      error: 'pass ?date=YYYY-MM-DD (all rows on that date) or ?id=<runs.id>',
    }, { status: 400 });
  }

  try {
    const rows = (await pool.query<RunRow>(
      idParam
        ? `SELECT id::text AS id, data, weather_enriched_at FROM runs
            WHERE user_uuid = $1 AND id = $2::BIGINT`
        : `SELECT id::text AS id, data, weather_enriched_at FROM runs
            WHERE user_uuid = $1
              AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) = $2
            ORDER BY (data->>'startLocal') DESC NULLS LAST`,
      idParam ? [userId, idParam] : [userId, date],
    )).rows;

    const FORECAST_HOST_FIX_DEPLOYED_MS = Date.parse('2026-06-02T20:30:00Z');
    const auditRows = await Promise.all(rows.map(async (row) => {
      const r = row.data ?? {};

      // Field-presence audit · NO coercion to 0. Tells us whether the
      // coord fields literally exist on the row, what their raw type is,
      // and whether any of the polyline fallback fields are populated.
      // This is the thing my last audit blurred · Number(null) === 0 was
      // hiding "field doesn't exist" as "field is 0".
      const coordFields = {
        startLat: typedValue(r.startLat),
        startLng: typedValue(r.startLng),
        start_lat: typedValue(r.start_lat),
        start_lng: typedValue(r.start_lng),
        startLatLng: typedValue(r.startLatLng),
        start_latlng: typedValue(r.start_latlng),
        routeStartLat: typedValue(r.routeStartLat),
        routeStartLng: typedValue(r.routeStartLng),
        start_latitude: typedValue(r.start_latitude),
        start_longitude: typedValue(r.start_longitude),
        routePolyline: r.routePolyline ? `(string, len ${String(r.routePolyline).length})` : typedValue(r.routePolyline),
        polyline: r.polyline ? `(string, len ${String(r.polyline).length})` : typedValue(r.polyline),
        summaryPolyline: r.summaryPolyline ? `(string, len ${String(r.summaryPolyline).length})` : typedValue(r.summaryPolyline),
      };

      // Mirror pickLatLng's actual logic to show what enrichOneActivity
      // would pick · same priority order as lib/weather/openmeteo.ts.
      const pickedCoords = pickLatLngForAudit(r);

      const startLocal = r.startLocal ?? r.start_local ?? null;
      const startISO = startLocal ? toUtcIso(startLocal, r.source as string | undefined) : null;
      const startISOProper = startISO; // alias for clarity in the response
      const startISORaw = startLocal ? naiveDateParse(startLocal) : null; // what fetchRunWeather sees if it skips toUtcIso
      const durationSec = Number(r.movingTimeS) || Number(r.durationSec) || Number(r.elapsedTimeS) || 0;

      // Auto-correct verdict · evaluate each condition explicitly
      const idIsNumeric = /^-?\d+$/.test(String(row.id));
      const ageDays = startISO ? (Date.now() - Date.parse(startISO)) / (1000 * 60 * 60 * 24) : NaN;
      const isRecent = isFinite(ageDays) && ageDays <= 5;
      const sourceOpenMeteo = r?.weather?.source === 'open-meteo';
      const hasEnrichedAt = Boolean(row.weather_enriched_at);
      const enrichedAtMs = row.weather_enriched_at ? Date.parse(row.weather_enriched_at) : NaN;
      const enrichedBeforeFix = isFinite(enrichedAtMs) && enrichedAtMs < FORECAST_HOST_FIX_DEPLOYED_MS;
      const willFire =
        idIsNumeric && isRecent && sourceOpenMeteo && hasEnrichedAt && enrichedBeforeFix;

      // Live Open-Meteo fetch using THE COORDS pickLatLng actually finds.
      // This shows what the real enrichment WOULD return given the row's
      // actual stored data. If pickedCoords is null, weather can't be
      // fetched at all · that's the upstream bug.
      const live = (pickedCoords && startISO)
        ? await fetchBothHosts(pickedCoords.lat, pickedCoords.lng, startISO, durationSec)
        : null;

      // Also dump all the top-level keys on data so we can spot any field
      // I'm not looking at by name.
      const allKeys = Object.keys(r).sort();

      return {
        id: row.id,
        source: r.source ?? null,
        startLocal,
        startISORaw,         // what Date.parse(startLocal) sees · no tz handling
        startISOProper,      // what toUtcIso returns · source-aware
        startISO,
        ageDays: isFinite(ageDays) ? Math.round(ageDays * 100) / 100 : null,
        mergedIntoId: r.mergedIntoId ?? null,
        durationSec,
        coordFields,         // per-field presence + type · no Number(null)=0 lie
        pickedCoords,        // what pickLatLng would return · null if none
        allDataKeys: allKeys, // every top-level key on data
        storedTempF: r.tempF ?? null,
        storedWeather: r.weather ?? null,
        weather_enriched_at: row.weather_enriched_at,
        autoCorrectVerdict: {
          willFire,
          conditions: {
            idIsNumeric,
            isRecent,
            sourceOpenMeteo,
            hasEnrichedAt,
            enrichedBeforeFix,
          },
        },
        liveOpenMeteoAtPickedCoords: live,
      };
    }));

    return NextResponse.json({
      userId,
      query: { date, id: idParam },
      forecastHostFixDeployedISO: '2026-06-02T20:30:00Z',
      rows: auditRows,
    }, {
      headers: { 'Cache-Control': 'private, no-cache, must-revalidate' },
    });
  } catch (err: any) {
    return NextResponse.json({
      error: err.message ?? String(err),
      stack: err.stack ?? null,
    }, { status: 500 });
  }
}

/** Describe a field's actual type + value without coercion. */
function typedValue(v: any): { type: string; value: any } {
  if (v === undefined) return { type: 'undefined', value: null };
  if (v === null) return { type: 'null', value: null };
  if (Array.isArray(v)) return { type: `array(${v.length})`, value: v };
  return { type: typeof v, value: v };
}

/** Mirror lib/weather/openmeteo.ts:pickLatLng exactly so the audit
 *  reports what enrichOneActivity would actually do. */
function pickLatLngForAudit(data: any): { lat: number; lng: number; source: string } | null {
  if (!data) return null;
  const sll = data.startLatLng ?? data.start_latlng;
  if (Array.isArray(sll) && sll.length >= 2) {
    const nlat = Number(sll[0]); const nlng = Number(sll[1]);
    if (isFinite(nlat) && isFinite(nlng)) return { lat: nlat, lng: nlng, source: 'startLatLng' };
  }
  const lat = data.startLat ?? data.start_lat ?? data.routeStartLat;
  const lng = data.startLng ?? data.start_lng ?? data.routeStartLng;
  const nlat = Number(lat); const nlng = Number(lng);
  if (isFinite(nlat) && isFinite(nlng) && (lat !== undefined && lng !== undefined)) {
    // Note: this branch returns 0,0 if the values are literally 0 · which
    // is a bug in pickLatLng itself (Encino isn't at lat=0). Caller's
    // responsibility to detect Gulf-of-Guinea sentinel.
    return { lat: nlat, lng: nlng, source: 'startLat/startLng' };
  }
  const poly = typeof data.routePolyline === 'string' ? data.routePolyline
              : typeof data.polyline === 'string' ? data.polyline
              : typeof data.summaryPolyline === 'string' ? data.summaryPolyline
              : null;
  if (poly) {
    const pt = decodePolylineFirstAudit(poly);
    if (pt) return { lat: pt[0], lng: pt[1], source: 'polyline-decoded' };
  }
  return null;
}

/** Decode just the first pair from a Google polyline (precision 5). */
function decodePolylineFirstAudit(str: string): [number, number] | null {
  let index = 0;
  const readVal = (): number | null => {
    let result = 0, shift = 0, byte: number;
    do {
      if (index >= str.length) return null;
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return ((result & 1) ? ~(result >> 1) : (result >> 1)) / 1e5;
  };
  const lat = readVal();
  const lng = readVal();
  if (lat == null || lng == null) return null;
  return [lat, lng];
}

/** What Date.parse sees when given a no-Z local string · this is the bug
 *  in fetchRunWeather (called from /api/ingest/workout without toUtcIso). */
function naiveDateParse(local: string): string | null {
  const ms = Date.parse(local);
  if (!isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

async function fetchBothHosts(lat: number, lng: number, startISO: string, durationSec: number) {
  const startDate = startISO.slice(0, 10);
  const endISO = durationSec > 0
    ? new Date(Date.parse(startISO) + durationSec * 1000).toISOString()
    : startISO;
  const endDate = endISO.slice(0, 10);
  const startMs = Date.parse(startISO);
  const endMs = Date.parse(endISO);

  const buildUrl = (base: string) =>
    `${base}?latitude=${lat}&longitude=${lng}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&hourly=temperature_2m,relativehumidity_2m,cloudcover,weathercode` +
    `&temperature_unit=fahrenheit&timezone=UTC`;

  const [forecast, archive] = await Promise.all([
    fetchAndSummarize(
      buildUrl('https://api.open-meteo.com/v1/forecast'),
      startMs, endMs,
    ),
    fetchAndSummarize(
      buildUrl('https://archive-api.open-meteo.com/v1/archive'),
      startMs, endMs,
    ),
  ]);
  return { forecast, archive };
}

async function fetchAndSummarize(url: string, startMs: number, endMs: number) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { error: `HTTP ${r.status}`, url };
    const j: any = await r.json();
    const times: string[] = j?.hourly?.time ?? [];
    const temps: (number | null)[] = j?.hourly?.temperature_2m ?? [];
    if (times.length === 0) return { error: 'no hourly data', url };

    // Find buckets covering [startMs, endMs]. If endMs <= startMs, just
    // take the bucket nearest startMs.
    const samples: Array<{ t: string; tempF: number | null }> = [];
    if (endMs > startMs) {
      for (let i = 0; i < times.length; i++) {
        const tMs = Date.parse(times[i] + 'Z');
        if (!isFinite(tMs)) continue;
        const bucketEnd = tMs + 3600 * 1000;
        if (bucketEnd <= startMs) continue;
        if (tMs >= endMs) break;
        samples.push({ t: times[i], tempF: temps[i] != null ? Number(temps[i]) : null });
      }
    }
    if (samples.length === 0) {
      // single-point fallback
      let bestIdx = 0;
      let bestDelta = Infinity;
      for (let i = 0; i < times.length; i++) {
        const tMs = Date.parse(times[i] + 'Z');
        const d = Math.abs(tMs - startMs);
        if (d < bestDelta) { bestDelta = d; bestIdx = i; }
      }
      samples.push({ t: times[bestIdx], tempF: temps[bestIdx] != null ? Number(temps[bestIdx]) : null });
    }

    const validTemps = samples.map(s => s.tempF).filter((x): x is number => x != null);
    return {
      url,
      hours_sampled: samples.length,
      samples,
      temp_f_start: samples[0]?.tempF ?? null,
      temp_f_end: samples[samples.length - 1]?.tempF ?? null,
      temp_f_peak: validTemps.length > 0 ? Math.max(...validTemps) : null,
      temp_f_mean: validTemps.length > 0
        ? Math.round(validTemps.reduce((a, b) => a + b, 0) / validTemps.length * 10) / 10
        : null,
    };
  } catch (err: any) {
    return { error: err.message ?? String(err), url };
  }
}
