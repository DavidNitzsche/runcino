import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g,'').trim();
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });

// Get column types first
const colTypes = (await pool.query(`
  SELECT column_name, data_type, udt_name
  FROM information_schema.columns
  WHERE table_name='coach_intents'
`, [])).rows;
console.log('coach_intents columns:', colTypes.map(c=>`${c.column_name}:${c.udt_name}`).join(', '));

// Raw rows for these dates — just field + octet_length of value text
const rows = (await pool.query(`
  SELECT id, ts::date AS date, field,
         octet_length(value::text) AS val_bytes,
         left(value::text, 80) AS val_preview
  FROM coach_intents
  WHERE user_uuid=$1
    AND ts::date IN ('2026-06-05','2026-05-29','2026-05-27','2026-05-25')
  ORDER BY ts DESC
`, [DAVID])).rows;
console.log('\nrows:');
for (const r of rows) console.log(`  id=${r.id} date=${r.date} field=${String(r.field).slice(0,45).padEnd(46)} bytes=${r.val_bytes} preview=${r.val_preview?.slice(0,60)}`);

// Run wids
const runs = (await pool.query(`
  SELECT (data->>'date') AS date, (data->>'client_workout_id') AS wid
  FROM runs WHERE user_uuid=$1
    AND (data->>'date') IN ('2026-06-05','2026-05-29','2026-05-27')
    AND (data->>'source')='watch'
  ORDER BY (data->>'date') DESC
`, [DAVID])).rows;
console.log('\nwatch run wids:');
for (const r of runs) console.log(`  ${r.date} wid=${r.wid}`);
await pool.end();
