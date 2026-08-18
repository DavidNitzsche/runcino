import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g,'').trim();
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });

const ci = (await pool.query(
  `SELECT id, field, value FROM coach_intents WHERE user_uuid=$1 AND ts::date='2026-06-05' ORDER BY id LIMIT 3`,
  [DAVID]
)).rows;
for (const c of ci) {
  const v = c.value;
  const keys = Object.keys(v ?? {});
  const isNumericKeyed = keys.length > 0 && keys.every(k => /^\d+$/.test(k));
  if (isNumericKeyed) {
    const arr = keys.sort((a,b)=>+a-+b).map(k => v[k]);
    console.log(`\nid=${c.id} field=${c.field}`);
    console.log(`  numeric-keyed array len=${arr.length}`);
    const sample = arr[0];
    if (sample && typeof sample === 'object') {
      console.log(`  item keys: ${Object.keys(sample).join(',')}`);
      console.log(`  first item: ${JSON.stringify(sample)}`);
      console.log(`  second item: ${JSON.stringify(arr[1])}`);
    }
  } else {
    console.log(`\nid=${c.id} field=${c.field}`);
    console.log(`  object keys: ${keys.slice(0,15).join(',')}`);
    if (v.workoutId) console.log(`  workoutId=${v.workoutId}`);
    if (v.phases) console.log(`  phases count=${v.phases.length}`);
  }
}
await pool.end();
