import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g,'').trim();
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });

// Read the small payloads fully (May 27, May 29)
const small = (await pool.query(`
  SELECT id, ts::date AS date, field, value
  FROM coach_intents WHERE user_uuid=$1
    AND ts::date IN ('2026-05-29','2026-05-27')
    AND octet_length(value) < 1000
  ORDER BY ts DESC
`, [DAVID])).rows;
for (const r of small) {
  let parsed;
  try { parsed = JSON.parse(r.value); } catch { parsed = r.value; }
  console.log(`\n=== id=${r.id} date=${r.date.toISOString?.()?.slice(0,10) ?? r.date} ===`);
  if (typeof parsed === 'object') {
    const keys = Object.keys(parsed);
    console.log('keys:', keys.join(', '));
    const phases = parsed.phases ?? [];
    console.log('phases:', phases.length);
    for (const p of phases) {
      const ps = p.paceSamples ?? [];
      console.log(`  phase type=${p.type} dist=${p.actualDistanceMi} dur=${p.actualDurationSec}s paceSamples=${ps.length}`);
    }
  } else {
    console.log('raw:', String(parsed).slice(0, 200));
  }
}

// Confirm June 5 parses correctly as text→JSON
const jun5 = (await pool.query(`
  SELECT id, octet_length(value) AS bytes, left(value, 100) AS head, right(value, 50) AS tail
  FROM coach_intents WHERE id=193
`, [])).rows[0];
console.log(`\nJune 5 (id=193): ${jun5.bytes} bytes`);
console.log('head:', jun5.head);
console.log('tail:', jun5.tail);

// Quick check: is the June 5 payload valid JSON? Parse first+last chars
const jun5full = (await pool.query(`SELECT value FROM coach_intents WHERE id=193`, [])).rows[0];
let jun5parsed;
try { jun5parsed = JSON.parse(jun5full.value); } catch(e) { console.log('PARSE ERROR:', e.message); }
if (jun5parsed) {
  const phases = jun5parsed.phases ?? [];
  console.log('\nJune 5 parsed OK. phases:', phases.length);
  for (const p of phases) {
    const ps = p.paceSamples ?? [];
    console.log(`  phase type=${p.type} dist=${p.actualDistanceMi} dur=${p.actualDurationSec}s paceSamples=${ps.length}`);
    if (ps.length > 0) {
      console.log(`  first sample: ${JSON.stringify(ps[0])}`);
      console.log(`  last sample:  ${JSON.stringify(ps[ps.length-1])}`);
      // Check distMi accuracy
      const lastDist = ps[ps.length-1].distMi;
      const actualDist = jun5parsed.totalDistanceMi;
      console.log(`  lastSample.distMi=${lastDist} vs totalDistanceMi=${actualDist} delta=${Math.abs(lastDist-actualDist).toFixed(4)}mi`);
    }
  }
}
await pool.end();
