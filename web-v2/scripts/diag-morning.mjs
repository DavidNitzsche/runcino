import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const userId = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const today = '2026-05-27';

console.log('═══ TODAY CHECK-INS ═══');
const checkIns = (await pool.query(
  `SELECT ts, value, reason FROM coach_intents
    WHERE user_id = $1 AND reason = 'morning_checkin'
      AND ts >= ($2::date - interval '7 days')
    ORDER BY ts DESC LIMIT 10`,
  [userId, today]
)).rows;
console.log(JSON.stringify(checkIns, null, 2));

console.log('\n═══ SLEEP LAST 7 DAYS ═══');
const sleep = (await pool.query(
  `SELECT sample_date, value FROM health_samples
    WHERE user_id = $1 AND sample_type = 'sleep_hours'
      AND sample_date >= ($2::date - interval '7 days')
    ORDER BY sample_date DESC`,
  [userId, today]
)).rows;
console.log(JSON.stringify(sleep, null, 2));

console.log('\n═══ YESTERDAY (2026-05-26) RUN ═══');
const run = (await pool.query(
  `SELECT data->>'type' AS type, data->>'name' AS name,
          data->>'distanceMi' AS mi, data->>'avgPaceMinPerMi' AS pace,
          data->>'avgHr' AS hr, data->>'maxHr' AS max_hr,
          data->>'phasesPatchedManually' AS patched
     FROM strava_activities
    WHERE (user_uuid = $1 OR user_uuid IS NULL)
      AND data->>'date' = '2026-05-26'
      AND NOT (data ? 'mergedIntoId')
    ORDER BY data->>'startLocal' DESC LIMIT 1`,
  [userId]
)).rows[0];
console.log(JSON.stringify(run, null, 2));

console.log('\n═══ BRIEFINGS CACHE STATE ═══');
const briefs = (await pool.query(
  `SELECT surface, signature, created_at FROM briefings WHERE user_id::text = $1 ORDER BY created_at DESC`,
  [userId]
)).rows;
console.log(JSON.stringify(briefs, null, 2));

console.log('\n═══ RACES (AFC? polyline?) ═══');
const races = (await pool.query(
  `SELECT slug, meta->>'name' AS name, meta->>'priority' AS pri, meta->>'date' AS date,
          (course_geometry IS NOT NULL) AS has_geo
     FROM races
    WHERE (user_uuid = $1 OR user_uuid IS NULL)
      AND (meta->>'date')::date >= '2026-01-01'
    ORDER BY meta->>'date' ASC`,
  [userId]
)).rows;
console.log(JSON.stringify(races, null, 2));

console.log('\n═══ STRAVA CONNECTION (last 14d activity) ═══');
const strava = (await pool.query(
  `SELECT MAX(COALESCE(data->>'date', LEFT(data->>'startLocal',10))::text) AS last
     FROM strava_activities
    WHERE (user_uuid = $1 OR user_uuid IS NULL)
      AND NOT (data ? 'mergedIntoId')`,
  [userId]
)).rows[0];
console.log('Last activity date:', strava?.last);

await pool.end();
