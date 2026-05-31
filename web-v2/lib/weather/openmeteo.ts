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
import { toUtcIso } from '@/lib/runs/normalize-time';

export interface RunWeather {
  /**
   * Legacy single-point temperature, kept as the "headline" temp so
   * existing consumers don't break. For span-enriched runs this equals
   * temp_f_start. Recap-engine and any heat-aware reader should prefer
   * temp_f_peak when present · it's the conditions the runner actually
   * fought through, not the conditions at the start line.
   */
  temp_f: number | null;
  /** Temp at run start (= temp_f for back-compat). */
  temp_f_start?: number | null;
  /** Temp at run end. */
  temp_f_end?: number | null;
  /** Hottest hour the run spanned · the recap's preferred reading. */
  temp_f_peak?: number | null;
  /** Time-weighted mean across the run's hour buckets. */
  temp_f_mean?: number | null;
  /** Number of hour buckets sampled. 1 = single-point fallback. */
  hours_sampled?: number;
  humidity_pct: number | null;
  /** Peak humidity across the span. */
  humidity_pct_peak?: number | null;
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

/**
 * Fetch hourly weather across a run's full duration, not just the start.
 *
 * Why this exists: a long run in LA can start at 65°F and end at 75°F.
 * The legacy fetchRunWeather captured only the start bucket, so the
 * recap engine saw "65°F · within optimal range" even when the runner
 * fought heat in the back half. This walks every hour bucket the run
 * spans and rolls them into a thermal-arc payload:
 *
 *   temp_f_start · the headline at gun
 *   temp_f_peak  · the hottest hour the run touched (what the body felt)
 *   temp_f_end   · what the cooldown landed in
 *   temp_f_mean  · time-weighted mean across buckets
 *
 * Returns null on any failure; callers fall back to fetchRunWeather.
 */
export async function fetchRunWeatherSpan(
  lat: number,
  lng: number,
  startISO: string,
  endISO: string,
): Promise<RunWeather | null> {
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const startMs = Date.parse(startISO);
  const endMs = Date.parse(endISO);
  if (!isFinite(startMs) || !isFinite(endMs) || endMs <= startMs) return null;

  try {
    // Open-Meteo's archive returns whole-day hourly data; we just need
    // the start date and (rarely) the next day if the run crosses
    // midnight UTC.
    const startDate = startISO.slice(0, 10);
    const endDate = endISO.slice(0, 10);
    const url = `https://archive-api.open-meteo.com/v1/archive` +
      `?latitude=${lat}` +
      `&longitude=${lng}` +
      `&start_date=${startDate}` +
      `&end_date=${endDate}` +
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

    // Find the index range that covers [start, end]. Inclusive on the
    // hour that contains the start; inclusive on the hour that contains
    // (end - 1 minute) so a run ending right at the top of the next
    // hour doesn't sample the cooldown-bucket weather.
    const h = json.hourly;
    const samples: Array<{
      t: number;
      temp: number | null;
      hum: number | null;
      wind: number | null;
      gust: number | null;
      cloud: number | null;
      precip: number | null;
      cond: string | null;
    }> = [];
    for (let i = 0; i < times.length; i++) {
      const tMs = Date.parse(times[i] + 'Z');
      if (!isFinite(tMs)) continue;
      // Hour bucket [tMs, tMs + 3600s) — include if it overlaps the run.
      const bucketEnd = tMs + 3600 * 1000;
      if (bucketEnd <= startMs) continue;
      if (tMs >= endMs) break;
      samples.push({
        t: tMs,
        temp: num(h.temperature_2m?.[i]),
        hum: num(h.relativehumidity_2m?.[i]),
        wind: num(h.windspeed_10m?.[i]),
        gust: num(h.windgusts_10m?.[i]),
        cloud: num(h.cloudcover?.[i]),
        precip: num(h.precipitation?.[i]),
        cond: conditionFromCode(h.weathercode?.[i]),
      });
    }

    if (samples.length === 0) {
      // Run was shorter than an hour bucket gap · fall back to single point.
      return await fetchRunWeather(lat, lng, startISO);
    }

    const temps = samples.map(s => s.temp).filter((x): x is number => x != null);
    const hums = samples.map(s => s.hum).filter((x): x is number => x != null);
    const winds = samples.map(s => s.wind).filter((x): x is number => x != null);
    const gusts = samples.map(s => s.gust).filter((x): x is number => x != null);
    const clouds = samples.map(s => s.cloud).filter((x): x is number => x != null);
    const precips = samples.map(s => s.precip).filter((x): x is number => x != null);

    const mean = (arr: number[]) => arr.length === 0 ? null
      : Math.round(arr.reduce((s, x) => s + x, 0) / arr.length * 10) / 10;

    const tempStart = samples[0].temp;
    const tempEnd = samples[samples.length - 1].temp;
    const tempPeak = temps.length === 0 ? null : Math.max(...temps);
    const tempMean = mean(temps);

    // Pick the most common condition across the span as the "headline"
    // weather; clear-most-of-the-run weighs heavier than a passing cloud.
    const condCount = new Map<string, number>();
    for (const s of samples) if (s.cond) condCount.set(s.cond, (condCount.get(s.cond) ?? 0) + 1);
    let conditions: string | null = null;
    let bestN = 0;
    for (const [c, n] of condCount) if (n > bestN) { bestN = n; conditions = c; }

    return {
      temp_f: tempStart,                      // back-compat headline
      temp_f_start: tempStart,
      temp_f_end: tempEnd,
      temp_f_peak: tempPeak,
      temp_f_mean: tempMean,
      hours_sampled: samples.length,
      humidity_pct: mean(hums),
      humidity_pct_peak: hums.length === 0 ? null : Math.max(...hums),
      wind_mph: mean(winds),
      wind_gust_mph: gusts.length === 0 ? null : Math.max(...gusts),
      cloud_cover_pct: mean(clouds),
      precip_in: precips.length === 0 ? null
        : Math.round(precips.reduce((s, x) => s + x, 0) * 10) / 10,  // sum, not mean
      conditions,
      fetched_at: new Date().toISOString(),
      source: 'open-meteo',
    };
  } catch (err) {
    console.error('[weather] fetchRunWeatherSpan failed:', err);
    return null;
  }
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
       FROM runs
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
 * Decode the first point of a Google-encoded polyline string. Returns
 * null on malformed input. Used as a last-ditch GPS fallback for watch
 * rows that carry routePolyline but no flat startLatLng pair (Apple
 * HealthKit's CMRouteBuilder output is polyline-only).
 *
 * Algorithm: Google's polyline encoding · Mapbox & Apple use the same
 * spec. See https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
function decodePolylineStart(s: string): { lat: number; lng: number } | null {
  if (typeof s !== 'string' || s.length < 4) return null;
  let i = 0;
  function nextValue(): number | null {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (i >= s.length) return null;
      byte = s.charCodeAt(i++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const delta = (result & 1) ? ~(result >> 1) : (result >> 1);
    return delta / 1e5;
  }
  const lat = nextValue();
  const lng = nextValue();
  if (lat == null || lng == null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/**
 * Pull a (lat, lng) pair off a Strava activity's `data` blob, tolerating
 * the shapes we've seen in the wild:
 *   - flat scalar pair: `startLat` / `startLng`  (legacy)
 *   - snake_case scalar pair: `start_lat` / `start_lng`
 *   - array form: `startLatLng` = [lat, lng]    (Strava's native shape)
 *   - polyline-derived: `routeStartLat` / `routeStartLng`
 *   - polyline-decoded: first point of `routePolyline` (Apple HK shape)
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
  if (isFinite(nlat) && isFinite(nlng)) return { lat: nlat, lng: nlng };

  // Last resort: decode the first point of routePolyline. The watch-app
  // ingest path stores the polyline but not a discrete startLatLng pair.
  const poly = typeof data.routePolyline === 'string' ? data.routePolyline
              : typeof data.polyline === 'string' ? data.polyline
              : typeof data.summaryPolyline === 'string' ? data.summaryPolyline
              : null;
  if (poly) return decodePolylineStart(poly);

  return null;
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
    `SELECT id, data FROM runs WHERE id = $1::BIGINT LIMIT 1`,
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

  if (!coords || !startISO) {
    // Mark un-enrichable rows (no GPS or no startLocal) so the cron's
    // pending filter doesn't keep pulling them into every batch.
    // Without this, ~30 GPS-less HK rows occupied a slot every night,
    // returned null, and stayed in the queue forever — pushing more
    // recent runs that DO have GPS out of the LIMIT 20 window.
    // weather_enriched_at = NOW() is a "we tried, no input was usable"
    // marker; data.weather stays absent so consumers correctly hide
    // the weather card for these rows.
    await pool.query(
      `UPDATE runs SET weather_enriched_at = NOW() WHERE id = $1::BIGINT`,
      [String(activityId)],
    ).catch(() => {});
    return null;
  }

  // Normalize startLocal into a confident UTC ISO before parsing.
  // Different ingest paths stamp startLocal with different timezone
  // conventions (apple_watch is local-no-Z; watch + Strava are UTC-no-Z;
  // strava webhook + apple_health are UTC-with-Z). Date.parse on the
  // ambiguous shapes interprets them as server-local · the recap engine
  // runs on Railway (UTC) and so a local-PDT row would shift the
  // weather window by ~7 hours. toUtcIso reads `source` to pick the
  // right interpretation. See lib/runs/normalize-time.ts.
  const utcStartISO = toUtcIso(startISO, row.data?.source as string | undefined) ?? startISO;

  // Prefer the span fetch when we know how long the run was · captures
  // the thermal arc instead of just the start-line temperature.
  const durSec = Number(row.data?.movingTimeS) || Number(row.data?.durationSec)
                || Number(row.data?.elapsedTimeS) || 0;
  let w: RunWeather | null = null;
  if (durSec > 60) {
    const endISO = new Date(Date.parse(utcStartISO) + durSec * 1000).toISOString();
    w = await fetchRunWeatherSpan(coords.lat, coords.lng, utcStartISO, endISO);
  }
  if (!w) {
    // Fallback to legacy single-point fetch.
    w = await fetchRunWeather(coords.lat, coords.lng, utcStartISO);
  }
  if (!w) {
    // Still mark attempted so we don't re-poll forever
    await pool.query(
      `UPDATE runs SET weather_enriched_at = NOW() WHERE id = $1::BIGINT`,
      [String(activityId)],
    );
    return null;
  }

  await pool.query(
    `UPDATE runs
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
 * AND retries previously-attempted-but-failed rows once a week, on the
 * theory that Open-Meteo flake (transient 5xx, network blips) resolves
 * by the next pass.
 *
 * The original query only matched `weather_enriched_at IS NULL`, which
 * meant any row that got stamped during a failed Open-Meteo call (or
 * stamped-as-un-enrichable for missing GPS) sat in `attempted_no_weather`
 * limbo forever. Combined with the un-enrichable rows being pulled into
 * every batch, the cron made very little real progress.
 *
 * New filter:
 *   - never-attempted (NULL)                            → always pick up
 *   - attempted >7 days ago AND still no `data.weather` → retry
 *
 *  …both gated by `data ? 'startLatLng'` so we don't waste a slot on
 *  rows we already know are GPS-less. (The earlier null-coord fix
 *  ensures any such rows that DO slip in get stamped quickly and stop
 *  re-appearing.)
 */
export async function enrichRecent(daysBack: number = 14, batchSize: number = 20): Promise<{ enriched: number; attempted: number }> {
  // jsonb_typeof gate: 23 rows have `startLatLng` as JSONB null (key
  // present, value null) — the `?` operator returns true for those,
  // so the prior filter pulled them into every batch only for
  // enrichOneActivity to bail at pickLatLng. Filter on the value
  // shape (array, or real flat scalars) to skip them at the source.
  const rows = (await pool.query(
    `SELECT id FROM runs
      WHERE (data->>'date')::date >= CURRENT_DATE - $1::int
        AND data ? 'startLocal'
        AND (
              jsonb_typeof(data->'startLatLng') = 'array'
              OR jsonb_typeof(data->'startLat') = 'number'
              OR jsonb_typeof(data->'start_lat') = 'number'
              OR jsonb_typeof(data->'routeStartLat') = 'number'
            )
        AND NOT (data ? 'weather')
        AND (
              weather_enriched_at IS NULL
              OR weather_enriched_at < NOW() - INTERVAL '7 days'
            )
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
