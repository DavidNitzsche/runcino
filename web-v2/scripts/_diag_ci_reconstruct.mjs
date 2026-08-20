import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g,'').trim();
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });

const r = (await pool.query(`SELECT value FROM coach_intents WHERE id=193`, [])).rows[0];
const v = r.value;
const keys = Object.keys(v).sort((a,b)=>+a-+b);
const str = keys.map(k => v[k]).join('');
const parsed = JSON.parse(str);
const topKeys = Object.keys(parsed);
console.log('top keys:', topKeys.join(', '));
console.log('workoutId:', parsed.workoutId);
console.log('totalDistanceMi:', parsed.totalDistanceMi);
console.log('totalDurationSec:', parsed.totalDurationSec);
const phases = parsed.phases ?? [];
console.log('phases count:', phases.length);
for (const p of phases) {
  const ps = p.paceSamples ?? [];
  const hs = p.hrSamples ?? [];
  console.log(`\nphase[${p.index}] type=${p.type} label=${p.label}`);
  console.log(`  actualDistanceMi=${p.actualDistanceMi} actualDurationSec=${p.actualDurationSec}`);
  console.log(`  paceSamples: ${ps.length}  first 5:`, JSON.stringify(ps.slice(0,5)));
  console.log(`  hrSamples: ${hs.length}  first 3:`, JSON.stringify(hs.slice(0,3)));
}
await pool.end();
