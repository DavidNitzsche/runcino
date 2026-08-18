import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g, '').trim();
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });

// Any strava rows for David in the last 14 days?
const strava = (await pool.query(`
  SELECT id::text AS id, (data->>'date') AS date, (data->>'distanceMi')::float AS dist_mi,
         jsonb_array_length(COALESCE(data->'splits','[]'::jsonb)) AS splits_len,
         jsonb_array_length(COALESCE(data->'splits_standard','[]'::jsonb)) AS splits_std_len
  FROM runs
  WHERE user_uuid=$1 AND (data->>'source')='strava'
    AND (data->>'date')::date >= (CURRENT_DATE - INTERVAL '14 days')
  ORDER BY (data->>'date') DESC
`, [DAVID])).rows;

console.log(`Strava rows last 14d: ${strava.length}`);
for (const r of strava) console.log(`  ${r.date}  ${r.dist_mi}mi  splits=${r.splits_len}  splits_std=${r.splits_std_len}`);

// Connector state
const conn = (await pool.query(`
  SELECT provider, last_sync_at::text AS last_sync_at, last_sync_status, activities_count, disconnected_at::text AS disconnected_at
  FROM connector_tokens WHERE user_id=$1
`, [DAVID])).rows;
console.log('\nConnectors:');
for (const c of conn) console.log(' ', JSON.stringify(c));

await pool.end();
