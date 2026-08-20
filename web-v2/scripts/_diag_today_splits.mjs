import { Pool } from 'pg';
import { readFileSync } from 'node:fs';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const m = env.match(/^DATABASE_URL=(.+)$/m);
process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, '').trim();

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
});

// Today's run · full data shape inspection
const rows = (await pool.query(`
  SELECT
    id::text AS id,
    (data->>'source') AS source,
    (data->>'distanceMi')::float AS dist_mi,
    (data->>'durationSec')::float AS dur_sec,
    data->'splits' AS splits,
    data->'phases' AS phases,
    data->'workoutPhases' AS workout_phases,
    (data->>'mergedIntoId') AS merged_into,
    absorbed_into_canonical_at IS NOT NULL AS was_absorbed,
    (data->>'startedAtIso') AS started_iso
  FROM runs
  WHERE user_uuid = $1
    AND (data->>'date') = '2026-06-05'
  ORDER BY id DESC
`, [DAVID])).rows;

for (const r of rows) {
  console.log(`\n=== id=${r.id}  src=${r.source}  dist=${r.dist_mi}mi  dur=${Math.round(r.dur_sec/60)}min  created=${r.created_at} ===`);
  console.log(`  merged_into: ${r.merged_into ?? '(canonical)'}`);
  console.log(`  absorbed_into_canonical_at: ${r.was_absorbed}`);
  console.log(`  splits (len=${(r.splits||[]).length}):`);
  for (const s of (r.splits ?? [])) {
    console.log('    ', JSON.stringify(s));
  }
  console.log(`  phases (len=${(r.phases||[]).length}):`);
  for (const p of (r.phases ?? [])) {
    console.log('    ', JSON.stringify(p));
  }
  console.log(`  workoutPhases (len=${(r.workout_phases||[]).length}):`);
  for (const p of (r.workout_phases ?? [])) {
    console.log('    ', JSON.stringify(p));
  }
}
await pool.end();
