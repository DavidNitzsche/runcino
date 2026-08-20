import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g, '').trim();
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });

// Compare a working apple_watch row (2026-05-26 had splits=6) vs today's (splits=0)
const rows = (await pool.query(`
  SELECT
    id::text AS id,
    (data->>'date') AS date,
    (data->>'source') AS source,
    (data->>'distanceMi')::float AS dist_mi,
    jsonb_object_keys(data) AS top_key
  FROM runs
  WHERE user_uuid = $1
    AND (data->>'source') = 'apple_watch'
    AND (data->>'date') IN ('2026-05-26', '2026-06-05', '2026-06-04')
  ORDER BY (data->>'date') DESC
`, [DAVID])).rows;

const groups = new Map();
for (const r of rows) {
  const k = `${r.date} (${r.id}, ${r.dist_mi}mi)`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r.top_key);
}
console.log('apple_watch row top-level keys per date:');
for (const [k, keys] of groups) {
  console.log(`\n${k}: ${keys.sort().join(', ')}`);
}

// Look at the 2026-05-26 row's splits structure
const winner = (await pool.query(`
  SELECT data->'splits' AS splits, data->'splitsStandard' AS splitsStd, data->'splits_standard' AS splits_std
  FROM runs WHERE user_uuid=$1 AND (data->>'source')='apple_watch' AND (data->>'date')='2026-05-26' LIMIT 1
`, [DAVID])).rows[0];
console.log('\n=== 2026-05-26 apple_watch · sample split shape ===');
console.log('splits[0]:', JSON.stringify(winner?.splits?.[0] ?? null, null, 2));
console.log('splitsStandard exists?', !!winner?.splitsStd);
console.log('splits_standard exists?', !!winner?.splits_std);

await pool.end();
