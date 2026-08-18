import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g,'').trim();
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });

// Read items from the 49009-entry array (id=193, the workout completion)
const r = (await pool.query(
  `SELECT value FROM coach_intents WHERE id=193`,
  []
)).rows[0];
const v = r.value;
const keys = Object.keys(v).sort((a,b)=>+a-+b);
// Sample first 5, middle 5, last 5
const samples = [
  ...keys.slice(0,5),
  ...keys.slice(Math.floor(keys.length/2), Math.floor(keys.length/2)+5),
  ...keys.slice(-5)
];
console.log('total keys:', keys.length);
for (const k of samples) {
  console.log(`[${k}]:`, JSON.stringify(v[k]));
}
await pool.end();
