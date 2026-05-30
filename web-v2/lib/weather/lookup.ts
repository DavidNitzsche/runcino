/**
 * Weather lookup against `workout_weather_cache`.
 *
 * The cron at `/api/cron/enrich-weather` populates this table with
 * temp readings for the user's typical lat/lon. This reader is
 * grid-rounded to 0.1° (~10 km) to match how the cache keys.
 *
 * The post-run surface uses `lookupTempForActivity(activityDate, lat, lon)`
 * to fetch the temp of the run.
 * The pre-run surface uses `forecastTempForDate(date)` which falls back
 * to the runner's recent-baseline average when no forecast exists yet.
 */
import { pool } from '@/lib/db/pool';

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Exact-bucket lookup for the cached temperature at (lat, lon, date).
 * Returns null when no row exists (cron hasn't filled this point yet).
 */
export async function lookupTempF(lat: number, lon: number, dateISO: string): Promise<number | null> {
  const r = await pool.query<{ temperature_f: number | null }>(
    `SELECT temperature_f FROM workout_weather_cache
      WHERE lat_round = $1::numeric(4,1)
        AND lon_round = $2::numeric(5,1)
        AND date = $3::date
      LIMIT 1`,
    [round1(lat), round1(lon), dateISO],
  ).catch(() => ({ rows: [] }));
  const t = r.rows[0]?.temperature_f;
  return t == null ? null : Number(t);
}

/**
 * Nearest-recent baseline temp for a user's typical lat/lon. Used by
 * the post-run "hotter than normal" surface — a 60°F average is the
 * baseline against which we surface "78°F today, HR bump expected."
 *
 * Looks at the last 14 days at this lat/lon bucket and averages
 * non-null temps.
 */
export async function baselineTempF(
  lat: number,
  lon: number,
  todayISO: string,
  windowDays = 14,
): Promise<number | null> {
  const r = await pool.query<{ avg: string | null }>(
    `SELECT AVG(temperature_f) AS avg FROM workout_weather_cache
      WHERE lat_round = $1::numeric(4,1)
        AND lon_round = $2::numeric(5,1)
        AND date BETWEEN $3::date - $4::int AND $3::date
        AND temperature_f IS NOT NULL`,
    [round1(lat), round1(lon), todayISO, windowDays],
  ).catch(() => ({ rows: [] }));
  const avg = r.rows[0]?.avg;
  return avg == null ? null : Math.round(Number(avg));
}

/**
 * For a Strava activity row, extract the run's temp. Strava's payload
 * sometimes has `tempF` already populated (we set it during sync); when
 * absent, fall back to the cache lookup keyed by activity start coords
 * + date.
 */
export async function lookupTempForActivity(activity: {
  data?: Record<string, unknown> | null;
}): Promise<number | null> {
  const data = activity.data ?? {};
  const direct = data.tempF;
  if (typeof direct === 'number' && isFinite(direct)) return direct;

  const lat = Number(data.startLat ?? data.start_latitude);
  const lon = Number(data.startLng ?? data.start_longitude);
  const date = (data.date as string) || String(data.startLocal ?? '').slice(0, 10);
  if (!isFinite(lat) || !isFinite(lon) || !date) return null;
  return lookupTempF(lat, lon, date);
}
