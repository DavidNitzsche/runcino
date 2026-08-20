import fs from 'node:fs';
import pg from 'pg';
const env = fs.readFileSync('.env.local','utf8');
const url = (env.match(/^DATABASE_URL_RO=(.*)$/m)||[])[1] || (env.match(/^DATABASE_URL=(.*)$/m)||[])[1];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const uid = '0645f40c-951d-4ccc-b86e-9979cd26c795';

// 1. David's races: slug, date, priority, goal, actual_result provenance
const races = await c.query(`SELECT slug, meta->>'date' AS d, meta->>'priority' AS prio, meta->>'goalDisplay' AS goal, meta->>'goalSafeDisplay' AS goal_safe, meta->>'distanceLabel' AS dist, meta->>'finishTime' AS meta_finish,
  actual_result->>'finishS' AS ar_finish, actual_result->>'provisional' AS ar_prov, actual_result->>'source' AS ar_src
  FROM races WHERE user_uuid=$1 ORDER BY meta->>'date'`, [uid]);
console.log('RACES:', JSON.stringify(races.rows, null, 1));

// 2. Latest projection snapshots per distance
const snaps = await c.query(`SELECT DISTINCT ON (distance_mi) distance_mi, snapshot_date::text AS d, vdot, projection_sec, anchor_kind FROM projection_snapshots WHERE user_uuid=$1 ORDER BY distance_mi, snapshot_date DESC`, [uid]);
console.log('LATEST SNAPSHOTS:', JSON.stringify(snaps.rows));

// 3. plan proposals (pending / recent)
const props = await c.query(`SELECT id, kind, status, created_iso::text, payload->>'message' AS msg FROM plan_proposals WHERE user_uuid=$1 ORDER BY created_iso DESC LIMIT 12`, [uid]).catch(e=>({rows:[['err',e.message]]}));
console.log('PROPOSALS:', JSON.stringify(props.rows, null, 1));

// 4. active plan + tune-up race rows in plan_workouts
const plan = await c.query(`SELECT id::text, mode, race_id, authored_iso::text, archived_iso FROM training_plans WHERE user_uuid=$1 AND archived_iso IS NULL`, [uid]);
console.log('ACTIVE PLAN:', JSON.stringify(plan.rows));
if (plan.rows[0]) {
  const tune = await c.query(`SELECT date_iso, type, sub_label, distance_mi FROM plan_workouts WHERE plan_id=$1 AND (type='race' OR sub_label ILIKE '%race%' OR sub_label ILIKE '%tune%') ORDER BY date_iso`, [plan.rows[0].id]);
  console.log('PLAN RACE/TUNEUP ROWS:', JSON.stringify(tune.rows));
  const span = await c.query(`SELECT MIN(date_iso) AS a, MAX(date_iso) AS b, COUNT(*) FROM plan_workouts WHERE plan_id=$1`, [plan.rows[0].id]);
  console.log('PLAN SPAN:', JSON.stringify(span.rows));
}
await c.end();
