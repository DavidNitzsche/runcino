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
              (data ? 'startLatLng')                            OR
              (data ? 'startLat'    AND data ? 'startLng')      OR
              (data ? 'start_lat'   AND data ? 'start_lng')     OR
              (data ? 'routeStartLat' AND data ? 'routeStartLng')
            )
      ORDER BY COALESCE(data->>'date', LEFT(data->>'startLocal',10)) DESC
      LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  return pickLatLng(r?.data);
}

/**
 * Pull a (lat, lng) pair off a Strava activity's `data` blob, tolerating
 * the three shapes we've seen in the wild:
 *   - flat scalar pair: `startLat` / `startLng`  (legacy)
 *   - snake_case scalar pair: `start_lat` / `start_lng`
 *   - array form: `startLatLng` = [lat, lng]    (Strava's native shape)
 *   - polyline-derived: `routeStartLat` / `routeStartLng`
 *
 * Returns null when no usable coord is present (HK workouts with no GPS).
 */
function pickLatLng(data: any): { lat: number; lng: number } | null {
  if (!data) return null;
  const sll = data.startLatLng ?? data.start_latlng;
  let lat: any, lng: any;
  if (Array.isArray(sll) && sll.length >= 2) {
    lat = sll[0]; lng = sll[1];
  } else {
    lat = data.startLat ?? data.start_lat ?? data.routeStartLat;
    lng = data.startLng ?? data.start_lng ?? data.routeStartLng;
  }
  const nlat = Number(lat); const nlng = Number(lng);
  if (!isFinite(nlat) || !isFinite(nlng)) return null;
  return { lat: nlat, lng: nlng };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Mirror an enriched weather sample into `workout_weather_cache` so the
 * pre-run heat-adjustment lookup (lib/weather/lookup.ts) finds something
 * for the same lat/lon-bucket + date. Idempotent — primary key is
 * (lat_round, lon_round, date) so re-running just refreshes fetched_at.
 *
 * Called from `enrichOneActivity` after a successful Open-Meteo fetch,
 * and from the one-time backfill script that walks existing enriched runs.
 */
export async function upsertWeatherCache(
  lat: number,
  lng: number,
  dateISO: string,
  tempF: number | null,
): Promise<void> {
  if (tempF == null || !isFinite(lat) || !isFinite(lng)) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return;
  await pool.query(
    `INSERT INTO workout_weather_cache (lat_round, lon_round, date, temperature_f, fetched_at)
     VALUES ($1::numeric(4,1), $2::numeric(5,1), $3::date, $4::integer, NOW())
     ON CONFLICT (lat_round, lon_round, date)
     DO UPDATE SET temperature_f = EXCLUDED.temperature_f,
                   fetched_at    = NOW()`,
    [round1(lat), round1(lng), dateISO, Math.round(tempF)],
  );
}

/**
 * Enrich one strava_activities row. Reads start GPS from the activity's
 * `startLatLng` array (Strava-native), with fall-backs to flat scalar
 * pairs for older synced data; HK workouts without GPS return null.
 * Writes weather blob + tempF onto strava_activities AND mirrors the
 * temp into `workout_weather_cache` so the pre-run prescription can
 * read it back via lookup.ts.
 */
export async function enrichOneActivity(activityId: string | number): Promise<RunWeather | null> {
  const row = (await pool.query(
    `SELECT id, data FROM strava_activities WHERE id = $1::BIGINT LIMIT 1`,
    [String(activityId)],
  )).rows[0];
  if (!row) return null;

  const coords = pickLatLng(row.data);
  const startISO: string | undefined = row.data?.startLocal ?? row.data?.start_local ?? row.data?.startISO;
  const dateISO: string = (row.data?.date as string) || (startISO ? startISO.slice(0, 10) : '');

  // Already-enriched row: skip the fetch but still ensure the cache row exists.
  if (row.data?.weather) {
    const cached = row.data.weather as RunWeather;
    if (coords && dateISO && cached.temp_f != null) {
      await upsertWeatherCache(coords.lat, coords.lng, dateISO, cached.temp_f);
    }
    return cached;
  }

  if (!coords || !startISO) return null;

  const w = await fetchRunWeather(coords.lat, coords.lng, startISO);
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

  // Mirror into the per-grid-cell cache for the pre-run lookup path.
  if (dateISO) {
    await upsertWeatherCache(coords.lat, coords.lng, dateISO, w.temp_f);
  }

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
