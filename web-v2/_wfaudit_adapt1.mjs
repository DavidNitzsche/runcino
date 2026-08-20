import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const UID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const PLAN = 'pln_ca91f252bba50c74';

const plan = await pool.query(
  `SELECT id, race_id, authored_iso, last_adapted_at, adaptation_log FROM training_plans WHERE id = $1`, [PLAN]);
console.log('PLAN:', JSON.stringify(plan.rows[0], null, 1));

const wk = await pool.query(
  `SELECT pw.id, pw.date_iso::text AS d, pw.type, pw.sub_label, pw.distance_mi::text AS mi,
          pw.is_quality, pw.is_long, pw.original_sub_label, pw.notes
     FROM plan_workouts pw WHERE pw.plan_id = $1
      AND pw.date_iso::date BETWEEN '2026-06-25' AND '2026-07-20'
    ORDER BY pw.date_iso, pw.id`, [PLAN]);
console.log('\nWORKOUTS Jun25-Jul20:');
for (const r of wk.rows) console.log(r.d, r.type.padEnd(10), (r.mi??'').padEnd(6), r.is_quality?'Q':' ', r.is_long?'L':' ', r.sub_label ?? '', r.original_sub_label ? `(orig:${r.original_sub_label})` : '', r.notes ? `notes:${r.notes}` : '', r.id);

const intents = await pool.query(
  `SELECT ts::text, reason, field, value FROM coach_intents
    WHERE COALESCE(user_uuid::text, user_id) = $1 AND reason LIKE 'plan_adapt%'
      AND ts >= '2026-06-25' ORDER BY ts`, [UID]);
console.log('\nINTENTS since Jun25:');
for (const r of intents.rows) console.log(r.ts, r.reason, r.field, r.value);

const runs = await pool.query(
  `SELECT (data->>'date') AS d, (data->>'distanceMi') AS mi, data->>'type' AS type, id,
          (data ? 'mergedIntoId') AS merged
     FROM runs WHERE user_uuid = $1 AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) >= '2026-06-20'
    ORDER BY 1`, [UID]);
console.log('\nRUNS since Jun20:');
for (const r of runs.rows) console.log(r.d, r.mi, r.type, r.merged ? 'MERGED' : '');

const props = await pool.query(
  `SELECT id, created_at::text, proposal_kind, status, source FROM plan_proposals
    WHERE user_uuid = $1 AND created_at >= '2026-06-20' ORDER BY created_at`, [UID]);
console.log('\nPLAN_PROPOSALS since Jun20:');
for (const r of props.rows) console.log(r.created_at, r.proposal_kind, r.status, r.source, r.id);

await pool.end();
