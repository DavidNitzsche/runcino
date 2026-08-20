import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const UID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

const wp = await pool.query(
  `SELECT id, created_at::text, status, plan_workout_id, workout_date_iso, action_kind, action_payload, reason, evidence, source
     FROM plan_workout_proposals WHERE user_uuid = $1::uuid ORDER BY created_at DESC LIMIT 6`, [UID]);
for (const r of wp.rows) console.log(JSON.stringify(r, null, 1));

// plan_proposals all-time recent for drift check
const pp = await pool.query(
  `SELECT created_at::text, proposal_kind, status, source, reasons->>'drift_kind' AS dk
     FROM plan_proposals WHERE user_uuid = $1::uuid ORDER BY created_at DESC LIMIT 8`, [UID]);
console.log('\nplan_proposals recent:');
for (const r of pp.rows) console.log(r.created_at, r.proposal_kind, r.status, r.source, r.dk);

// authored_state weekly avg vs current
const st = await pool.query(`SELECT authored_state->>'weeklyAvg4w' AS w4 FROM training_plans WHERE id='pln_ca91f252bba50c74'`);
console.log('\nauthored weeklyAvg4w:', st.rows[0]);

// week_id of the twice-rescheduled workout vs its new date's week
const w = await pool.query(
  `SELECT pw.id, pw.date_iso::text, pw.week_id, pwk.start_iso::text AS wk_start, pwk.end_iso::text AS wk_end
     FROM plan_workouts pw LEFT JOIN plan_weeks pwk ON pwk.id = pw.week_id
    WHERE pw.id IN ('wko_da2d9254b8a60d12','wko_92b538a1cd7f7fcc','wko_b2c11c32cbfcebc0')`);
console.log('\nweek alignment:');
for (const r of w.rows) console.log(JSON.stringify(r));
await pool.end();
