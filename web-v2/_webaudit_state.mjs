import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const uid = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const q = async (label, sql, params = []) => {
  try {
    const r = await pool.query(sql, params);
    console.log('=== ' + label + ' (' + r.rowCount + ')');
    console.log(JSON.stringify(r.rows, null, 1).slice(0, 3000));
  } catch (e) { console.log('=== ' + label + ' ERR: ' + e.message); }
};

await q('races recent', `SELECT slug, meta->>'name' nm, meta->>'date' dt, meta->>'priority' pr,
  actual_result IS NOT NULL AS has_result,
  actual_result->>'finishDisplay' fin, actual_result->>'provisional' prov, actual_result->>'source' src
  FROM races WHERE user_uuid::text=$1 AND meta->>'date' >= '2026-07-01' ORDER BY meta->>'date' DESC LIMIT 6`, [uid]);

await q('active plans', `SELECT id, race_id, plan_type, authored_iso, archived_iso,
  (SELECT count(*) FROM plan_workouts pw WHERE pw.plan_id=tp.id) n_workouts,
  (SELECT min(date_iso) FROM plan_workouts pw WHERE pw.plan_id=tp.id) first_day,
  (SELECT max(date_iso) FROM plan_workouts pw WHERE pw.plan_id=tp.id) last_day
  FROM training_plans tp WHERE COALESCE(user_uuid::text,user_id)=$1 AND archived_iso IS NULL ORDER BY authored_iso DESC LIMIT 4`, [uid]);

await q('plan cols', `SELECT column_name FROM information_schema.columns WHERE table_name='training_plans'`);

await q('this week plan_workouts', `WITH active AS (SELECT id FROM training_plans WHERE COALESCE(user_uuid::text,user_id)=$1 AND archived_iso IS NULL ORDER BY authored_iso DESC LIMIT 1)
  SELECT pw.date_iso, pw.type, pw.distance_mi, pp.label phase
  FROM plan_workouts pw JOIN active a ON pw.plan_id=a.id
  LEFT JOIN plan_weeks pwk ON pwk.id=pw.week_id LEFT JOIN plan_phases pp ON pp.id=pwk.phase_id
  WHERE pw.date_iso BETWEEN '2026-08-14' AND '2026-08-24' ORDER BY pw.date_iso`, [uid]);

await q('plan_proposals', `SELECT id, status, kind, created_iso, substr(rationale,0,140) rat FROM plan_proposals WHERE user_uuid::text=$1 ORDER BY created_iso DESC LIMIT 5`, [uid]);
await q('workout proposals', `SELECT id, status, kind, date_iso, created_iso FROM plan_workout_proposals WHERE user_uuid::text=$1 ORDER BY created_iso DESC LIMIT 5`, [uid]);
await q('coach_proposals', `SELECT id, status, kind, created_at FROM coach_proposals WHERE user_uuid::text=$1 ORDER BY created_at DESC LIMIT 5`, [uid]);

await q('recent runs', `SELECT data->>'date' dt, data->>'type' ty, data->>'distanceMi' mi, data->>'source' src
  FROM runs WHERE user_uuid=$1::uuid AND NOT (data ? 'mergedIntoId') AND (data->>'date')::date >= '2026-08-10' ORDER BY data->>'date' DESC LIMIT 10`, [uid]);

await q('coach_log recent', `SELECT to_char(created_at,'YYYY-MM-DD HH24:MI') ts, kind, substr(body,0,120) body FROM coach_log WHERE user_uuid::text=$1 ORDER BY created_at DESC LIMIT 8`, [uid]);

await pool.end();
