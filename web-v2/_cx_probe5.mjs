import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const U = '0645f40c-951d-4ccc-b86e-9979cd26c795';
async function q(label, sql, params = []) {
  try {
    const r = await pool.query(sql, params);
    console.log('=== ' + label + ' (' + r.rows.length + ' rows) ===');
    console.log(JSON.stringify(r.rows, null, 1).slice(0, 7000));
  } catch (e) { console.log('=== ' + label + ' ERROR: ' + e.message); }
}
await q('pw cols', `SELECT column_name FROM information_schema.columns WHERE table_name='plan_workouts' ORDER BY ordinal_position`);
await q('recent plan rows', `SELECT pw.date_iso, pw.type, pw.sub_label, pw.distance_mi, (pw.workout_spec IS NOT NULL) AS has_spec, pw.workout_spec->>'session_note' AS session_note
  FROM plan_workouts pw JOIN training_plans tp ON tp.id=pw.plan_id
  WHERE tp.user_uuid=$1 AND tp.archived_iso IS NULL AND pw.date_iso BETWEEN '2026-08-05' AND '2026-08-20' ORDER BY pw.date_iso`, [U]);
await q('a spec sample', `SELECT pw.date_iso, pw.type, pw.workout_spec FROM plan_workouts pw JOIN training_plans tp ON tp.id=pw.plan_id
  WHERE tp.user_uuid=$1 AND tp.archived_iso IS NULL AND pw.type IN ('threshold','intervals','tempo') AND pw.workout_spec IS NOT NULL ORDER BY pw.date_iso DESC LIMIT 1`, [U]);
// trust surface: adaptations recorded
await q('adaptation audit', `SELECT column_name FROM information_schema.columns WHERE table_name='plan_adaptations' ORDER BY ordinal_position`);
await q('recent adaptations', `SELECT * FROM plan_adaptations ORDER BY 1 DESC LIMIT 5`);
await pool.end();
