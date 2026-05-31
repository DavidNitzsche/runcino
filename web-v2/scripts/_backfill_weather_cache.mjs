/**
 * One-time backfill: walk every enriched strava_activities row + every
 * row with start coords, and mirror (lat, lon, date, temp_f) into
 * `workout_weather_cache` so the pre-run prescription lookup
 * (lib/weather/lookup.ts) returns real values for past dates +
 * has 14-day baseline data for the cohort.
 *
 * Idempotent: PK on (lat_round, lon_round, date) → re-runs refresh
 * fetched_at, never duplicate. Non-destructive.
 *
 * Two passes:
 *   1. Activities that ALREADY have `data.weather.temp_f` → just upsert
 *      the existing temp, no Open-Meteo call needed.
 *   2. Activities with coords + date but NO weather → fetch from
 *      Open-Meteo, write back to strava_activities AND mirror into cache.
 *
 * Run from web-v2/:  node scripts/_backfill_weather_cache.mjs
 */
import pg from 'pg';
import fs from 'fs';

const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

function round1(n) { return Math.round(n * 10) / 10; }

function pickLatLng(d) {
  if (!d) return null;
  const sll = d.startLatLng ?? d.start_latlng;
  let lat, lng;
  if (Array.isArray(sll) && sll.length >= 2) { lat = sll[0]; lng = sll[1]; }
  else {
    lat = d.startLat ?? d.start_lat ?? d.routeStartLat;
    lng = d.startLng ?? d.start_lng ?? d.routeStartLng;
  }
  const nlat = Number(lat), nlng = Number(lng);
  if (!isFinite(nlat) || !isFinite(nlng)) return null;
  return { lat: nlat, lng: nlng };
}

function pickDate(d) {
  const date = d?.date;
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const sl = d?.startLocal ?? d?.start_local ?? d?.startISO;
  if (typeof sl === 'string' && sl.length >= 10) return sl.slice(0, 10);
  return null;
}

function conditionFromCode(code) {
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

function num(v) {
  if (v == null) return null;
  const n = Number(v); if (!isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

async function fetchRunWeather(lat, lng, startISO) {
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  try {
    const date = startISO.slice(0, 10);
    const url = `https://archive-api.open-meteo.com/v1/archive` +
      `?latitude=${lat}&longitude=${lng}&start_date=${date}&end_date=${date}` +
      `&hourly=temperature_2m,relativehumidity_2m,windspeed_10m,windgusts_10m,cloudcover,precipitation,weathercode` +
      `&temperature_unit=fahrenheit&windspeed_unit=mph&precipitation_unit=inch&timezone=UTC`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const json = await r.json();
    const times = json?.hourly?.time ?? [];
    if (times.length === 0) return null;
    const runMs = Date.parse(startISO);
    let bestIdx = 0, bestDelta = Infinity;
    for (let i = 0; i < times.length; i++) {
      const d = Math.abs(Date.parse(times[i] + 'Z') - runMs);
      if (d < bestDelta) { bestDelta = d; bestIdx = i; }
    }
    const h = json.hourly;
    return {
      temp_f:          num(h.temperature_2m?.[bestIdx]),
      humidity_pct:    num(h.relativehumidity_2m?.[bestIdx]),
      wind_mph:        num(h.windspeed_10m?.[bestIdx]),
      wind_gust_mph:   num(h.windgusts_10m?.[bestIdx]),
      cloud_cover_pct: num(h.cloudcover?.[bestIdx]),
      precip_in:       num(h.precipitation?.[bestIdx]),
      conditions:      conditionFromCode(h.weathercode?.[bestIdx]),
      fetched_at:      new Date().toISOString(),
      source:          'open-meteo',
    };
  } catch (err) {
    console.error('[fetchRunWeather]', err.message);
    return null;
  }
}

async function upsertCache(lat, lng, dateISO, tempF) {
  if (tempF == null || !isFinite(lat) || !isFinite(lng)) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return false;
  await pool.query(
    `INSERT INTO workout_weather_cache (lat_round, lon_round, date, temperature_f, fetched_at)
     VALUES ($1::numeric(4,1), $2::numeric(5,1), $3::date, $4::integer, NOW())
     ON CONFLICT (lat_round, lon_round, date)
     DO UPDATE SET temperature_f = EXCLUDED.temperature_f, fetched_at = NOW()`,
    [round1(lat), round1(lng), dateISO, Math.round(tempF)],
  );
  return true;
}

async function main() {
  const before = Number((await pool.query(`SELECT COUNT(*) AS n FROM workout_weather_cache`)).rows[0].n);
  console.log(`[backfill] starting — workout_weather_cache rows before: ${before}`);

  // ── Pass 1: rows that already have data.weather.temp_f
  // We need coords too (cache key needs them); the activity may NOT have coords
  // (e.g. HK with home-fallback enrichment) — skip those.
  const enriched = (await pool.query(`
    SELECT id, data
      FROM strava_activities
     WHERE data ? 'weather'
       AND (data ? 'startLatLng' OR data ? 'startLat' OR data ? 'start_lat')
  `)).rows;
  console.log(`[pass-1] enriched-with-coords rows: ${enriched.length}`);
  let pass1 = 0, pass1Skip = 0;
  for (const row of enriched) {
    const coords = pickLatLng(row.data);
    const date = pickDate(row.data);
    const t = row.data?.weather?.temp_f;
    if (!coords || !date || t == null) { pass1Skip++; continue; }
    const wrote = await upsertCache(coords.lat, coords.lng, date, Number(t));
    if (wrote) pass1++;
  }
  console.log(`[pass-1] cache rows written: ${pass1} (skipped ${pass1Skip})`);

  // ── Pass 2: rows that have coords + date but NO weather yet.
  // Fetch Open-Meteo for each (rate-limited to ~5/s to stay polite),
  // write back to strava_activities AND mirror into cache.
  const needFetch = (await pool.query(`
    SELECT id, user_uuid, data
      FROM strava_activities
     WHERE NOT (data ? 'weather')
       AND (data ? 'startLatLng' OR data ? 'startLat' OR data ? 'start_lat')
       AND (data ? 'date' OR data ? 'startLocal')
     ORDER BY (data->>'date') DESC NULLS LAST
  `)).rows;
  console.log(`[pass-2] coord-bearing un-enriched rows: ${needFetch.length}`);

  let pass2Fetch = 0, pass2Cache = 0, pass2Skip = 0;
  for (let i = 0; i < needFetch.length; i++) {
    const row = needFetch[i];
    const coords = pickLatLng(row.data);
    const date = pickDate(row.data);
    const startISO = row.data?.startLocal ?? row.data?.start_local ?? row.data?.startISO;
    if (!coords || !date || !startISO) { pass2Skip++; continue; }

    // Idempotency: if the cache cell already has a temp, skip the fetch.
    const existing = (await pool.query(
      `SELECT temperature_f FROM workout_weather_cache
        WHERE lat_round = $1::numeric(4,1) AND lon_round = $2::numeric(5,1) AND date = $3::date LIMIT 1`,
      [round1(coords.lat), round1(coords.lng), date],
    )).rows[0];
    if (existing?.temperature_f != null) {
      // Still mark activity attempted so the cron leaves it alone.
      await pool.query(`UPDATE strava_activities SET weather_enriched_at = NOW() WHERE id = $1::BIGINT`, [String(row.id)]);
      // And write tempF back on the activity for the post-run lookup.
      await pool.query(
        `UPDATE strava_activities
            SET data = jsonb_set(data, '{tempF}', to_jsonb($1::numeric))
          WHERE id = $2::BIGINT`,
        [Number(existing.temperature_f), String(row.id)],
      );
      pass2Cache++;
      continue;
    }

    const w = await fetchRunWeather(coords.lat, coords.lng, startISO);
    if (!w) {
      await pool.query(`UPDATE strava_activities SET weather_enriched_at = NOW() WHERE id = $1::BIGINT`, [String(row.id)]);
      pass2Skip++;
      continue;
    }
    pass2Fetch++;
    await pool.query(
      `UPDATE strava_activities
          SET data = jsonb_set(jsonb_set(data, '{weather}', $1::jsonb), '{tempF}', to_jsonb($2::numeric)),
              weather_enriched_at = NOW()
        WHERE id = $3::BIGINT`,
      [JSON.stringify(w), w.temp_f ?? null, String(row.id)],
    );
    if (await upsertCache(coords.lat, coords.lng, date, w.temp_f)) pass2Cache++;

    // ~5/s — be polite to Open-Meteo's free archive endpoint.
    await new Promise(res => setTimeout(res, 220));
    if (i % 20 === 19) console.log(`  …processed ${i + 1}/${needFetch.length}`);
  }
  console.log(`[pass-2] open-meteo fetches: ${pass2Fetch}, cache rows touched: ${pass2Cache}, skipped: ${pass2Skip}`);

  const after = Number((await pool.query(`SELECT COUNT(*) AS n FROM workout_weather_cache`)).rows[0].n);
  console.log(`[backfill] done — workout_weather_cache rows after: ${after}  (Δ ${after - before})`);

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
