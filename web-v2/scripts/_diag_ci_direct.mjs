import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g,'').trim();
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });

// What fields/types are in coach_intents for the dates of the stuck runs?
const rows = (await pool.query(`
  SELECT id, ts::date AS date, field,
         jsonb_typeof(value) AS val_type,
         CASE jsonb_typeof(value)
           WHEN 'object' THEN (SELECT count(*)::int FROM jsonb_object_keys(value))
           WHEN 'array'  THEN jsonb_array_length(value)
           ELSE 0
         END AS val_size
  FROM coach_intents
  WHERE user_uuid=$1
    AND ts::date IN ('2026-06-05','2026-05-29','2026-05-27','2026-05-25')
  ORDER BY ts DESC, id DESC
`, [DAVID])).rows;
console.log('coach_intents rows for stuck run dates:');
for (const r of rows) console.log(`  id=${r.id} date=${r.date} field=${r.field} val_type=${r.val_type} val_size=${r.val_size}`);

// Also check what the runs.data.client_workout_id looks like for those dates
const runs = (await pool.query(`
  SELECT (data->>'date') AS date, (data->>'source') AS src,
         (data->>'client_workout_id') AS wid
  FROM runs WHERE user_uuid=$1
    AND (data->>'date') IN ('2026-06-05','2026-05-29','2026-05-27')
    AND (data->>'source')='watch'
  ORDER BY (data->>'date') DESC
`, [DAVID])).rows;
console.log('\nwatch run wids:');
for (const r of runs) console.log(`  ${r.date} src=${r.src} wid=${r.wid}`);
await pool.end();
