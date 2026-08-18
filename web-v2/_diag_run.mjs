// READ-ONLY: does David's Jun 11 tempo run have splits + phase data?
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const uid = '0645f40c-951d-4ccc-b86e-9979cd26c795';

// the Jun 11 tempo run (watch source has splits)
const r = await pool.query(
  `SELECT id,
          data->>'source' AS src,
          data->>'date' AS date,
          COALESCE(data->>'date', LEFT(data->>'startLocal',10)) AS d,
          ROUND((data->>'distanceMi')::numeric,2) AS mi,
          jsonb_array_length(COALESCE(data->'splits','[]'::jsonb)) AS n_splits,
          (data ? 'splits') AS has_splits,
          (data->>'splitsUnreliable') AS splits_unreliable
     FROM runs
    WHERE user_uuid = $1::uuid AND NOT (data ? 'mergedIntoId')
      AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) = '2026-06-11'
    ORDER BY 1 DESC`, [uid]);
console.log('=== Jun 11 runs ===');
for (const x of r.rows) console.log(x);

// sample splits from the watch tempo run
const watch = r.rows.find(x => x.src === 'apple_watch' || x.has_splits);
if (watch) {
  const s = await pool.query(`SELECT data->'splits' AS splits FROM runs WHERE id=$1`, [watch.id]);
  const splits = s.rows[0]?.splits ?? [];
  console.log('\n=== splits sample (first 3) for run', watch.id, '===');
  console.log(JSON.stringify(splits.slice(0,3), null, 1));
  console.log('split keys:', splits[0] ? Object.keys(splits[0]) : '(none)');
}

// phase_breakdown source · coach_intents for this run?
const ci = await pool.query(
  `SELECT reason, field, LEFT(value, 60) AS value_head
     FROM coach_intents
    WHERE (user_uuid = $1::uuid OR user_id = $1::uuid)
      AND reason ILIKE '%phase%'
    ORDER BY ts DESC LIMIT 5`, [uid]).catch(e => ({ rows: [{ err: e.message }] }));
console.log('\n=== coach_intents phase rows (last 5) ===');
console.log(ci.rows.length ? ci.rows : '(none)');

await pool.end();
