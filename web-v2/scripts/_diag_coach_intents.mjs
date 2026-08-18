import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g,'').trim();
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });

// What's actually in coach_intents for the June 5 run?
const ci = (await pool.query(
  `SELECT id, ts::text, field, value FROM coach_intents WHERE user_uuid=$1 AND ts::date = '2026-06-05' ORDER BY ts DESC LIMIT 10`,
  [DAVID]
)).rows;
console.log(`June 5 coach_intents: ${ci.length} rows`);
for (const r of ci) {
  const val = r.value;
  const keys = val ? Object.keys(val) : [];
  console.log(`  id=${r.id} ts=${r.ts} field=${r.field} keys=[${keys.join(',')}]`);
  // If it has phases, show them
  if (val?.phases) {
    console.log(`    phases count=${val.phases.length}`);
    for (const p of val.phases) {
      const ps = p.paceSamples ?? [];
      console.log(`    phase type=${p.type} dist=${p.actualDistanceMi} paceSamples=${ps.length} first:`, JSON.stringify(ps[0]));
    }
  }
  if (val?.workoutId) console.log(`    workoutId=${val.workoutId}`);
}
await pool.end();
