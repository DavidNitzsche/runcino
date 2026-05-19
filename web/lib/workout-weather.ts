/**
 * Workout weather cache · L7 Signal 1 context filter
 *
 * Hydrates a (lat, lon, date) → temperature_f lookup using
 * Open-Meteo's free historical-archive endpoint (already wrapped by
 * lib/weather.ts → fetchHistoricalWeather). Caches results in
 * Postgres so repeated signal evaluations don't hammer the API.
 *
 * Why this lives outside lib/weather.ts: that module is forecast-
 * shaped (race-morning narratives, multiple periods, wind dir). For
 * the signal context filter we only need the START-period temp on a
 * historical date, so this is a thin specialized cache layer over it.
 *
 * Cache key rounding:
 *   - lat/lon rounded to 0.1° (≈ 10 km grid). Two workouts at the
 *     same gym share weather; two workouts a couple miles apart
 *     also share weather. This collapses neighbourhood noise into
 *     a single cache entry without losing meaningful resolution.
 *   - date is YYYY-MM-DD local. Historical weather doesn't change.
 *
 * Caller contract:
 *   - Returns `null` (NOT a throw) on any failure — network, parse,
 *     missing coords, missing date. The signal module treats null
 *     as "context unknown" — no attenuation, observation keeps its
 *     baseline weight. Conservative: we never block fitness signal
 *     because the weather API was flaky.
 *
 * Schema is created in lib/db.ts (workout_weather_cache).
 */

import { query } from './db';
import { fetchHistoricalWeather } from './weather';

interface CacheRow {
  temperature_f: number | null;
}

/** Lookup the morning-start temperature for a workout. Hits the
 *  cache first; on miss, fetches from Open-Meteo and writes back. */
export async function getWorkoutTemperatureF(
  lat: number | null,
  lon: number | null,
  dateISO: string | null,
): Promise<number | null> {
  if (lat == null || lon == null || !dateISO) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return null;

  // Round coords to 0.1° (one decimal) for the cache key.
  const latR = Math.round(lat * 10) / 10;
  const lonR = Math.round(lon * 10) / 10;

  try {
    const cached = await query<CacheRow>(
      `SELECT temperature_f FROM workout_weather_cache
        WHERE lat_round = $1 AND lon_round = $2 AND date = $3
        LIMIT 1`,
      [latR, lonR, dateISO],
    );
    if (cached.length > 0) {
      return cached[0].temperature_f;
    }
  } catch { /* fall through to fetch */ }

  // Cache miss — fetch + persist.
  let tempF: number | null = null;
  try {
    const summary = await fetchHistoricalWeather(lat, lon, dateISO, 7);
    tempF = summary.start_period?.temperature_f ?? null;
  } catch {
    tempF = null;
  }

  // Persist even on null-temperature so we don't re-fetch a (lat, lon,
  // date) that the API can't answer. The row stays with NULL temp;
  // subsequent reads return null without hitting the network.
  try {
    await query(
      `INSERT INTO workout_weather_cache (lat_round, lon_round, date, temperature_f)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (lat_round, lon_round, date) DO NOTHING`,
      [latR, lonR, dateISO, tempF],
    );
  } catch { /* cache write failure isn't fatal */ }

  return tempF;
}
