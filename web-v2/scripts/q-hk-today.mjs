import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

console.log('=== health_samples table schema ===');
const cols = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='health_samples' ORDER BY ordinal_position`);
for (const c of cols.rows) console.log(' ', c.column_name, c.data_type);

console.log('\n=== distinct sample_types ===');
const k = await pool.query(`SELECT DISTINCT sample_type FROM health_samples ORDER BY sample_type`);
console.log(k.rows.map(r => r.sample_type).join(', '));

console.log('\n=== today health_samples (last 2 days) ===');
const r = await pool.query(`
  SELECT sample_type, sample_date::text AS d, value, source, recorded_at::text AS rec, metadata
    FROM health_samples
   WHERE sample_date >= CURRENT_DATE - interval '1 day'
   ORDER BY recorded_at DESC
   LIMIT 50`);
for (const row of r.rows) console.log(row.sample_type, '·', row.d, '·', row.value, '·', row.source, '· rec:', row.rec, row.metadata ? '· meta:' + JSON.stringify(row.metadata) : '');

console.log('\n=== coach_intents schema ===');
const cic = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='coach_intents' ORDER BY ordinal_position`);
for (const c of cic.rows) console.log(' ', c.column_name, c.data_type);
console.log('\n=== coach_intents from today ===');
// 2026-08-24 · coach_intents timestamps its rows with `ts`; there is no
// `created_at` column, so this threw 42703 before it printed anything.
const ci = await pool.query(`SELECT * FROM coach_intents WHERE ts::date >= CURRENT_DATE - interval '1 day' ORDER BY ts DESC LIMIT 20`);
for (const row of ci.rows) console.log(JSON.stringify(row));

// 2026-08-24 · the "latest briefing" block that used to close this probe is
// gone. `briefings` was dropped from prod and has no successor: briefings are
// recomputed per read, never stored. What the coach actually SAID lives in
// coach_intents under reason 'coach_log_%' — the block above already dumps
// today's coach_intents, which covers it.

await pool.end();
