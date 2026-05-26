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
const ci = await pool.query(`SELECT * FROM coach_intents WHERE created_at::date >= CURRENT_DATE - interval '1 day' ORDER BY created_at DESC LIMIT 20`);
for (const row of ci.rows) console.log(JSON.stringify(row));

console.log('\n=== latest briefing for today ===');
const b = await pool.query(`
  SELECT surface, compact, generated_at::text AS generated_at,
         length(payload::text) AS payload_len
    FROM briefings
   WHERE user_id::text = $1
   ORDER BY generated_at DESC LIMIT 6`, ['0645f40c-951d-4ccc-b86e-9979cd26c795']);
for (const row of b.rows) console.log(JSON.stringify(row));

await pool.end();
