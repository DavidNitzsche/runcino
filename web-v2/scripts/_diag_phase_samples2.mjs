import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g,'').trim();
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });

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
  console.log(`\n=== ${r.date} · ${r.dist_mi}mi · wid=${r.wid} ===`);
  const ci = (await pool.query(
    `SELECT value FROM coach_intents WHERE user_uuid=$1 AND value::text LIKE $2 LIMIT 1`,
    [DAVID, `%${r.wid}%`]
  )).rows[0];
  if (!ci) { console.log('  no coach_intent'); continue; }
  const phases = ci.value?.phases ?? [];
  console.log(`  phases: ${phases.length}`);
  for (const p of phases) {
    const ps = p.paceSamples ?? [];
    console.log(`  phase[${p.index ?? '?'}] type=${p.type} dist=${p.actualDistanceMi}mi dur=${p.actualDurationSec}s`);
    console.log(`    paceSamples count=${ps.length}  first 4:`, JSON.stringify(ps.slice(0,4)));
    if (ps.length > 0) {
      const hasDist = ps.some(s => s.distMi != null);
      const hasPace = ps.some(s => s.paceSPerMi != null);
      console.log(`    hasDist=${hasDist}  hasPace=${hasPace}`);
    }
  }
}
await pool.end();
