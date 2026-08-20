import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g,'').trim();
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });

// Read a slice of the actual value for June 5
const r = (await pool.query(
  `SELECT id, field, value->>'0' AS v0, value->>'1' AS v1, value->>'2' AS v2,
          jsonb_array_length(CASE jsonb_typeof(value) WHEN 'array' THEN value ELSE NULL END) AS arr_len
   FROM coach_intents WHERE user_uuid=$1 AND field=$2`,
  [DAVID, '0645f40c-951d-4ccc-b86e-9979cd26c795-2026-06-05']
)).rows[0];
console.log('id=', r?.id, 'arr_len=', r?.arr_len);
console.log('v0=', r?.v0);
console.log('v1=', r?.v1);
console.log('v2=', r?.v2);

// Also try the watch completion raw storage
const ci2 = (await pool.query(
  `SELECT id, field, value FROM coach_intents WHERE user_uuid=$1 AND ts::date='2026-06-05' ORDER BY id LIMIT 3`,
  [DAVID]
)).rows;
for (const c of ci2) {
  const v = c.value;
  // If it's a real object check for workoutId / phases
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    console.log('\nObject:', c.id, 'field=', c.field, 'keys=', Object.keys(v).slice(0,10).join(','));
  } else if (Array.isArray(v)) {
    console.log('\nArray:', c.id, 'len=', v.length, 'first=', JSON.stringify(v[0]));
  } else {
    // numeric-keyed: reconstruct
    const arr = Object.entries(v ?? {}).sort((a,b)=>+a[0]-+b[0]).map(([,x])=>x);
    console.log('\nNumeric-keyed array:', c.id, 'len=', arr.length);
    console.log('  [0]=', JSON.stringify(arr[0]));
    console.log('  [1]=', JSON.stringify(arr[1]));
    if (arr[0] && typeof arr[0] === 'object') {
      console.log('  keys of [0]:', Object.keys(arr[0]).join(','));
    }
  }
}
await pool.end();
