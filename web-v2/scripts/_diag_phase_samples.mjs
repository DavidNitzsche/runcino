import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g,'').trim();
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });

// Check coach_intents schema first
const cols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='coach_intents' ORDER BY ordinal_position`)).rows.map(r=>r.column_name);
console.log('coach_intents cols:', cols.join(', '));

// Pull recent watch runs + their coach_intent blobs
const rows = (await pool.query(`
  SELECT r.id::text AS id, (r.data->>'date') AS date, (r.data->>'distanceMi')::float AS dist_mi,
         (r.data->>'client_workout_id') AS wid
  FROM runs r
  WHERE r.user_uuid = $1
    AND (r.data->>'source') = 'watch'
    AND (r.data->>'date')::date >= (CURRENT_DATE - INTERVAL '7 days')
  ORDER BY (r.data->>'date') DESC LIMIT 3
`, [DAVID])).rows;

for (const r of rows) {
  console.log(`\n=== ${r.date} · ${r.dist_mi}mi · run id=${r.id} · wid=${r.wid} ===`);
  const ci = (await pool.query(`SELECT * FROM coach_intents WHERE user_uuid=$1 AND value->>'workoutId'=$2 LIMIT 1`, [DAVID, r.wid])).rows[0];
  if (!ci) { console.log('  no coach_intent'); continue; }
  const phases = ci.value?.phases ?? [];
  console.log(`  event_type=${ci.event_type}, phases: ${phases.length}`);
  for (const p of phases) {
    const ps = p.paceSamples ?? [];
    const hs = p.hrSamples ?? [];
    console.log(`  phase[${p.index ?? '?'}] type=${p.type} dist=${p.actualDistanceMi}mi dur=${p.actualDurationSec}s`);
    console.log(`    paceSamples count=${ps.length} first3:`, JSON.stringify(ps.slice(0,3)));
    console.log(`    hrSamples count=${hs.length}`);
  }
}
await pool.end();
