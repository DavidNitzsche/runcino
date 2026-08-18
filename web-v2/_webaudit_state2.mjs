import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const uid = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const q = async (label, sql, params = []) => {
  try {
    const r = await pool.query(sql, params);
    console.log('=== ' + label + ' (' + r.rowCount + ')');
    console.log(JSON.stringify(r.rows, null, 1).slice(0, 3500));
  } catch (e) { console.log('=== ' + label + ' ERR: ' + e.message); }
};

await q('proposal-ish tables', `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name ILIKE '%proposal%' OR table_name ILIKE '%coach%' OR table_name ILIKE '%brief%' OR table_name ILIKE '%log%') ORDER BY 1`);

await q('active plan', `SELECT id, mode, race_id, goal_iso, authored_iso, archive_reason,
  (SELECT min(date_iso) FROM plan_workouts pw WHERE pw.plan_id=tp.id) first_day,
  (SELECT max(date_iso) FROM plan_workouts pw WHERE pw.plan_id=tp.id) last_day
  FROM training_plans tp WHERE COALESCE(user_uuid::text,user_id)=$1 AND archived_iso IS NULL ORDER BY authored_iso DESC LIMIT 3`, [uid]);

await q('plan_proposals cols', `SELECT column_name FROM information_schema.columns WHERE table_name='plan_proposals'`);
await q('plan_proposals rows', `SELECT * FROM plan_proposals WHERE user_uuid::text=$1 OR user_id=$1 ORDER BY 1 DESC LIMIT 4`, [uid]);
await q('coach_proposals cols', `SELECT column_name FROM information_schema.columns WHERE table_name='coach_proposals'`);
await q('workout_proposals cols', `SELECT column_name FROM information_schema.columns WHERE table_name='plan_workout_proposals'`);
await q('races AFC full', `SELECT meta, actual_result FROM races WHERE user_uuid::text=$1 AND slug='americas-finest-city'`, [uid]);
await pool.end();
