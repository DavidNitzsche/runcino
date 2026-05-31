import { Pool } from 'pg';
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function q(sql, params=[]) { return (await pool.query(sql, params)).rows; }
try {
  console.log('=== ACTIVE training_plans rows ===');
  const active = await q(`SELECT id, user_uuid::text AS user_uuid, user_id, race_id, mode, goal_iso, authored_iso, archived_iso FROM training_plans WHERE (user_uuid = $1 OR user_id='me') AND archived_iso IS NULL ORDER BY authored_iso DESC LIMIT 3`, [DAVID]);
  console.log(JSON.stringify(active, null, 2));

  console.log('\n=== ALL races with actual_result for David ===');
  const races = await q(`SELECT slug, meta->>'name' AS name, meta->>'date' AS date, meta->>'priority' AS priority, meta->>'distanceMi' AS dist_mi, meta->>'goalDisplay' AS goal, meta->>'finishTime' AS meta_finish, actual_result->>'finishS' AS ar_finishS, actual_result->>'finishDisplay' AS ar_finishDisplay FROM races WHERE user_uuid=$1 ORDER BY (meta->>'date') ASC`, [DAVID]);
  console.log(JSON.stringify(races, null, 2));

  console.log('\n=== Races in last 180 days, priority IN (A,B) ===');
  const recent = await q(`SELECT slug, meta->>'name' AS name, meta->>'date' AS date, meta->>'priority' AS priority, meta->>'distanceMi' AS dist_mi, meta->>'finishTime' AS meta_finish, actual_result->>'finishS' AS ar_finishS FROM races WHERE (user_uuid=$1 OR user_uuid IS NULL) AND (meta->>'date')::date >= (CURRENT_DATE - interval '180 days') AND (meta->>'date')::date < CURRENT_DATE AND meta->>'priority' IN ('A','B') ORDER BY (meta->>'date') ASC`, [DAVID]);
  console.log(JSON.stringify(recent, null, 2));

  console.log('\n=== Strava activities near the race dates (for match-fallback) ===');
  for (const r of recent) {
    const around = await q(`SELECT id, data->>'date' AS date, data->>'name' AS name, (data->>'distanceMi')::numeric AS mi, (data->>'movingTimeS')::numeric AS sec FROM runs WHERE (user_uuid=$1 OR user_uuid IS NULL) AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) BETWEEN ($2::date - 1)::text AND ($2::date + 1)::text ORDER BY data->>'date'`, [DAVID, r.date]);
    console.log(`${r.slug} (${r.date}): ${around.length} candidate runs`);
    for (const a of around.slice(0,3)) console.log(`  ${a.date} · ${a.name} · ${a.mi}mi · ${a.sec}s`);
  }
} catch (e) { console.error(e); } finally { await pool.end(); }
