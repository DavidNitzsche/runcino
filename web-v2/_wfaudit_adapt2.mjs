import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const UID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

const intents = await pool.query(
  `SELECT ts::text, reason, field, value FROM coach_intents
    WHERE (user_uuid = $1::uuid OR user_id = $1)
      AND reason LIKE 'plan_adapt%' AND ts >= '2026-06-25' ORDER BY ts`, [UID]);
console.log('INTENTS since Jun25:');
for (const r of intents.rows) console.log(r.ts, '|', r.reason, '|', r.field, '|', r.value);

const runs = await pool.query(
  `SELECT COALESCE(data->>'date', LEFT(data->>'startLocal',10)) AS d, data->>'distanceMi' AS mi, data->>'type' AS type,
          (data ? 'mergedIntoId') AS merged
     FROM runs WHERE user_uuid = $1::uuid AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) >= '2026-06-20'
    ORDER BY 1`, [UID]);
console.log('\nRUNS since Jun20:');
for (const r of runs.rows) console.log(r.d, r.mi, r.type, r.merged ? 'MERGED' : '');

const props = await pool.query(
  `SELECT id, created_at::text, proposal_kind, status, source FROM plan_proposals
    WHERE user_uuid = $1::uuid AND created_at >= '2026-06-20' ORDER BY created_at`, [UID]);
console.log('\nPLAN_PROPOSALS since Jun20:');
for (const r of props.rows) console.log(r.created_at, r.proposal_kind, r.status, r.source, r.id);

const wprops = await pool.query(
  `SELECT id, created_at::text, status FROM plan_workout_proposals
    WHERE user_uuid = $1::uuid AND created_at >= '2026-06-20' ORDER BY created_at`, [UID]).catch(e => ({ rows: [], err: e.message }));
console.log('\nWORKOUT_PROPOSALS:', JSON.stringify(wprops.rows ?? wprops.err));

// race date for AFC
const race = await pool.query(`SELECT slug, meta->>'date' AS date, meta->>'distanceMi' AS mi, meta->>'priority' AS pri FROM races WHERE user_uuid = $1::uuid ORDER BY (meta->>'date')`, [UID]);
console.log('\nRACES:'); for (const r of race.rows) console.log(r.slug, r.date, r.mi, r.pri);
await pool.end();
