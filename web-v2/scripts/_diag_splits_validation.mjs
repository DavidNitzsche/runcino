import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g, '').trim();
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });

const rows = (await pool.query(`
  SELECT
    (data->>'date') AS date,
    (data->>'distanceMi')::float AS dist_mi,
    (data->>'durationSec')::float AS dur_sec,
    data->'splits_validation' AS v,
    data->'splits_unreliable' AS unreliable,
    jsonb_array_length(COALESCE(data->'splits','[]'::jsonb)) AS splits_kept
  FROM runs
  WHERE user_uuid = $1
    AND (data->>'source') = 'apple_watch'
    AND (data->>'date')::date >= (CURRENT_DATE - INTERVAL '14 days')
  ORDER BY (data->>'date') DESC
`, [DAVID])).rows;

for (const r of rows) {
  console.log(`\n=== ${r.date} · ${r.dist_mi}mi · ${Math.round(r.dur_sec/60)}min ===`);
  console.log(`  splits kept on row: ${r.splits_kept}`);
  console.log(`  splits_unreliable: ${r.unreliable ?? '(not set)'}`);
  console.log(`  splits_validation: ${JSON.stringify(r.v)}`);
}
await pool.end();
