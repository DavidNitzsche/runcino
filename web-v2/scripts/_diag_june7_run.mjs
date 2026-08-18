import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g,'').trim();
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });

const rows = (await pool.query(`
  SELECT id::text, (data->>'source') AS src, (data->>'distanceMi')::float AS dist,
         (data->>'mergedIntoId') AS merged_into,
         jsonb_array_length(COALESCE(data->'splits','[]'::jsonb)) AS splits_n,
         (data->>'routePolyline') IS NOT NULL AS has_polyline,
         octet_length(data->>'routePolyline') AS polyline_bytes,
         (data->>'elevGainFt') AS elev_gain,
         (data->>'type') AS run_type,
         (data->>'name') AS run_name,
         jsonb_object_keys(data) AS k
  FROM runs
  WHERE user_uuid=$1 AND (data->>'date')='2026-06-07'
  ORDER BY id DESC
`, [DAVID])).rows;

// Group by id
const byId = new Map();
for (const r of rows) {
  if (!byId.has(r.id)) byId.set(r.id, { ...r, keys: [] });
  byId.get(r.id).keys.push(r.k);
}
for (const [id, r] of byId) {
  const cflag = r.merged_into ? `MERGED→${r.merged_into}` : 'CANONICAL';
  console.log(`\nid=${id}  src=${r.src}  dist=${r.dist}mi  splits=${r.splits_n}  has_polyline=${r.has_polyline}  polyline_bytes=${r.polyline_bytes ?? 0}  elev_gain=${r.elev_gain ?? 'null'}  type=${r.run_type ?? 'null'}  name=${r.run_name}  ${cflag}`);
  console.log(`  keys: ${r.keys.sort().join(', ')}`);
}
await pool.end();
