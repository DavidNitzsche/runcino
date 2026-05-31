/**
 * P31 — weather enrichment via Open-Meteo (free, no key needed).
 *
 * Fetches temperature / humidity / wind / conditions at a (lat,lng,UTC)
 * triple and returns a normalized payload that gets folded into
 * strava_activities.data so the coach can read it via getRuns.
 *
 * Docs: https://open-meteo.com/en/docs/historical-weather-api
 */
import { pool } from '@/lib/db/pool';

export interface RunWeather {
  temp_f: number | null;
  humidity_pct: number | null;
  wind_mph: number | null;
  wind_gust_mph: number | null;
  cloud_cover_pct: number | null;
  precip_in: number | null;
  conditions: string | null;        // "clear" | "cloudy" | "rain" | "snow" | "wind"
  fetched_at: string;               // ISO UTC
  source: 'open-meteo';
}

/**
 * Map Open-Meteo weather codes to a coarse "condition" label the coach
 * can read. See https://open-meteo.com/en/docs WMO Weather interpretation.
 */
function conditionFromCode(code: number | null | undefined): string | null {
  if (code == null) return null;
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'mostly_clear';
  if (code === 3) return 'cloudy';
  if (code >= 45 && code <= 48) return 'fog';
  if (code >= 51 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'rain_shower';
  if (code >= 85 && code <= 86) return 'snow_shower';
  if (code >= 95) return 'thunderstorm';
  return null;
}

/**
 * Fetch historical hourly weather for the run's start time + location.
 * Returns null on any error — weather is enrichment, not a critical path.
 */
export async function fetchRunWeather(
  lat: number,
  lng: number,
  startISO: string,
): Promise<RunWeather | null> {
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  try {
    const date = startISO.slice(0, 10);
    const url = `https://archive-api.open-meteo.com/v1/archive` +
      `?latitude=${lat}` +
      `&longitude=${lng}` +
      `&start_date=${date}` +
      `&end_date=${date}` +
      `&hourly=temperature_2m,relativehumidity_2m,windspeed_10m,windgusts_10m,` +
      `cloudcover,precipitation,weathercode` +
      `&temperature_unit=fahrenheit` +
      `&windspeed_unit=mph` +
      `&precipitation_unit=inch` +
      `&timezone=UTC`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const json: any = await r.json();
    const times: string[] = json?.hourly?.time ?? [];
    if (times.length === 0) return null;

    // Find the hour bucket closest to the run start.
    const runMs = Date.parse(startISO);
    let bestIdx = 0;
    let bestDelta = Infinity;
    for (let i = 0; i < times.length; i++) {
      const d = Math.abs(Date.parse(times[i] + 'Z') - runMs);
      if (d < bestDelta) { bestDelta = d; bestIdx = i; }
    }

    const h = json.hourly;
    return {
      temp_f:         num(h.temperature_2m?.[bestIdx]),
      humidity_pct:   num(h.relativehumidity_2m?.[bestIdx]),
      wind_mph:       num(h.windspeed_10m?.[bestIdx]),
      wind_gust_mph:  num(h.windgusts_10m?.[bestIdx]),
      cloud_cover_pct: num(h.cloudcover?.[bestIdx]),
      precip_in:      num(h.precipitation?.[bestIdx]),
      conditions:     conditionFromCode(h.weathercode?.[bestIdx]),
      fetched_at:     new Date().toISOString(),
      source:         'open-meteo',
    };
  } catch (err) {
    console.error('[weather] fetchRunWeather failed:', err);
    return null;
  }
}

function num(v: any): number | null {
  if (v == null) return null;
  const n = Number(v);
  if (!isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

export interface DayForecast {
  date: string;                   // YYYY-MM-DD
  temp_min_f: number | null;      // day's low
  temp_max_f: number | null;      // day's high
  conditions: string | null;      // coarse label
  precip_chance_pct: number | null;
  wind_mph: number | null;
  source: 'open-meteo';
}

/**
 * Fetch a single-day forecast for a (lat, lng) on a given YYYY-MM-DD.
 * Used by the /today + /train surfaces to render a temp range for
 * planned-but-not-yet-run days. For past days the historical archive
 * endpoint (fetchRunWeather) is what enriches the actual conditions.
 *
 * Returns null when the date is too far out (Open-Meteo forecast covers
 * ~16 days forward) or the network call fails.
 */
export async function fetchDayForecast(
  lat: number,
  lng: number,
  dateIso: string,
): Promise<DayForecast | null> {
  if (!isFinite(lat) || !isFinite(lng)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return null;
  try {
    const url = `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}` +
      `&longitude=${lng}` +
      `&start_date=${dateIso}` +
      `&end_date=${dateIso}` +
      `&daily=temperature_2m_max,temperature_2m_min,weathercode,precipitation_probability_max,windspeed_10m_max` +
      `&temperature_unit=fahrenheit` +
      `&windspeed_unit=mph` +
      `&timezone=auto`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j: any = await r.json();
    const d = j?.daily;
    if (!d?.time?.length) return null;
    return {
      date: dateIso,
      temp_min_f: num(d.temperature_2m_min?.[0]),
      temp_max_f: num(d.temperature_2m_max?.[0]),
      conditions: conditionFromCode(d.weathercode?.[0]),
      precip_chance_pct: num(d.precipitation_probability_max?.[0]),
      wind_mph: num(d.windspeed_10m_max?.[0]),
      source: 'open-meteo',
    };
  } catch (err) {
    console.error('[weather] fetchDayForecast failed:', err);
    return null;
  }
}

/**
 * Resolve the runner's "home base" lat/lng from the most recent run that
 * shipped GPS. Falls back to null when no run has GPS — caller hides the
 * weather card entirely in that case.
 */
export async function resolveHomeLatLng(userId: string): Promise<{ lat: number; lng: number } | null> {
  const r = (await pool.query(
    `SELECT data
       FROM strava_activities
      WHERE user_uuid = $1
        AND NOT (data ? 'mergedIntoId')
        AND (
              (data ? 'startLat'    AND data ? 'startLng')    OR
              (data ? 'start_lat'   AND data ? 'start_lng')   OR
              (data ? 'routeStartLat' AND data ? 'routeStartLng')
            )
      ORDER BY COALESCE(data->>'date', LEFT(data->>'startLocal',10)) DESC
      LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!r?.data) return null;
  const d = r.data;
  const lat = Number(d.startLat ?? d.start_lat ?? d.routeStartLat);
  const lng = Number(d.startLng ?? d.start_lng ?? d.routeStartLng);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * Enrich one strava_activities row. Reads start GPS from the route
 * polyline's first coord (fall back to nothing if no route — we can't
 * geo-locate the run without it). Updates data.weather + sets
 * weather_enriched_at so the nightly job doesn't redo it.
 */
export async function enrichOneActivity(activityId: string | number): Promise<RunWeather | null> {
  const row = (await pool.query(
    `SELECT id, data FROM strava_activities WHERE id = $1::BIGINT LIMIT 1`,
    [String(activityId)],
  )).rows[0];
  if (!row) return null;
  if (row.data?.weather) return row.data.weather as RunWeather;

  const lat = row.data?.startLat ?? row.data?.start_lat ?? row.data?.routeStartLat;
  const lng = row.data?.startLng ?? row.data?.start_lng ?? row.data?.routeStartLng;
  const startISO: string | undefined = row.data?.startLocal ?? row.data?.start_local ?? row.data?.startISO;

  if (lat == null || lng == null || !startISO) return null;

  const w = await fetchRunWeather(Number(lat), Number(lng), startISO);
  if (!w) {
    // Still mark attempted so we don't re-poll forever
    await pool.query(
      `UPDATE strava_activities SET weather_enriched_at = NOW() WHERE id = $1::BIGINT`,
      [String(activityId)],
    );
    return null;
  }

  await pool.query(
    `UPDATE strava_activities
        SET data = jsonb_set(jsonb_set(data, '{weather}', $1::jsonb), '{tempF}', to_jsonb($2::numeric)),
            weather_enriched_at = NOW()
      WHERE id = $3::BIGINT`,
    [JSON.stringify(w), w.temp_f ?? null, String(activityId)],
  );
  return w;
}

/**
 * Nightly cron entry point. Walks recent runs that aren't enriched yet
 * (or were enriched > 7 days ago and have a route start) and tries them.
 */
export async function enrichRecent(daysBack: number = 14, batchSize: number = 20): Promise<{ enriched: number; attempted: number }> {
  const rows = (await pool.query(
    `SELECT id FROM strava_activities
      WHERE (data->>'date')::date >= CURRENT_DATE - $1::int
        AND weather_enriched_at IS NULL
        AND data ? 'startLocal'
      ORDER BY (data->>'date') DESC
      LIMIT $2`,
    [daysBack, batchSize],
  )).rows;

  let enriched = 0;
  for (const r of rows) {
    const w = await enrichOneActivity(r.id);
    if (w) enriched++;
  }
  return { enriched, attempted: rows.length };
}
