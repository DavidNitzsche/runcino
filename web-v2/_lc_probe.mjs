import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const uid = '0645f40c-951d-4ccc-b86e-9979cd26c795'; // David

const q = (sql, params) => pool.query(sql, params).then(r => r.rows).catch(e => [{ ERROR: e.message }]);

// 1. active plan(s)
console.log('ACTIVE PLANS:', JSON.stringify(await q(
  `SELECT id, race_id, mode, authored_iso, archived_iso, archive_reason
     FROM training_plans WHERE user_uuid=$1 AND archived_iso IS NULL`, [uid]), null, 1));

// 2. recent plan_proposals (is plan-drift cron alive? any race_graduate?)
console.log('RECENT PROPOSALS:', JSON.stringify(await q(
  `SELECT id, proposal_kind, status, created_at::text, reasons->>'message' AS msg
     FROM plan_proposals WHERE user_uuid=$1
     ORDER BY created_at DESC LIMIT 10`, [uid]), null, 1));

// 3. any race_graduate ever, any user
console.log('GRADUATES EVER:', JSON.stringify(await q(
  `SELECT user_uuid, proposal_kind, status, created_at::text
     FROM plan_proposals WHERE proposal_kind='race_graduate'
     ORDER BY created_at DESC LIMIT 5`, []), null, 1));

// 4. races for David: AFC + upcoming
console.log('RACES:', JSON.stringify(await q(
  `SELECT slug, meta->>'date' AS date, meta->>'priority' AS pri, meta->>'name' AS name,
          meta->>'distanceLabel' AS dist, actual_result, meta->>'finishTime' AS metafinish
     FROM races WHERE user_uuid=$1 ORDER BY (meta->>'date')::date`, [uid]), null, 1));

// 5. last plan_workouts dates on the active plan
console.log('LAST PLAN DAYS:', JSON.stringify(await q(
  `SELECT pw.date_iso, pw.type, pw.distance_mi
     FROM plan_workouts pw JOIN training_plans tp ON tp.id=pw.plan_id
    WHERE tp.user_uuid=$1 AND tp.archived_iso IS NULL
    ORDER BY pw.date_iso DESC LIMIT 6`, [uid]), null, 1));

// 6. the race-day run row
console.log('RACE RUN:', JSON.stringify(await q(
  `SELECT data->>'date' AS date, data->>'workoutType' AS wt, data->>'workoutTypeSource' AS wts,
          data->>'distanceMi' AS mi, data->>'durationSec' AS sec, data->>'source' AS src
     FROM runs WHERE user_uuid=$1::uuid AND (data->>'date')::date >= '2026-08-15'
       AND NOT (data ? 'mergedIntoId') ORDER BY data->>'date'`, [uid]), null, 1));

// 7. notifications recently (is the notif cron alive, anything race related)
console.log('NOTIF LOG RECENT:', JSON.stringify(await q(
  `SELECT category, fired_at::text, delivered FROM notifications_log
    WHERE COALESCE(user_uuid::text,user_id)=$1 ORDER BY fired_at DESC LIMIT 8`, [uid]), null, 1));

// 8. cron liveness: latest snapshot/readiness rows
console.log('PROJ SNAPSHOTS RECENT:', JSON.stringify(await q(
  `SELECT snapshot_date::text, distance_mi, vdot, source FROM projection_snapshots
    WHERE user_uuid=$1 ORDER BY snapshot_date DESC, distance_mi LIMIT 6`, [uid]), null, 1));

await pool.end();
