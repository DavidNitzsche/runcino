import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const userId = '0645f40c-951d-4ccc-b86e-9979cd26c795';

const cols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='briefings'`)).rows.map(r => r.column_name);
console.log('briefings cols:', cols);

const briefs = (await pool.query(
  `SELECT * FROM briefings WHERE user_id::text = $1 ORDER BY generated_at DESC LIMIT 3`,
  [userId]
)).rows;
for (const b of briefs) {
  console.log(`\n--- ${b.surface} @ ${b.generated_at} ---`);
  for (const k of cols) {
    const v = b[k];
    if (typeof v === 'object' && v !== null) {
      console.log(`  ${k}:`, JSON.stringify(v).slice(0, 1000));
    } else if (typeof v === 'string' && v.length > 200) {
      console.log(`  ${k}: ${v.slice(0, 500)}...`);
    } else {
      console.log(`  ${k}:`, v);
    }
  }
}

const ci = (await pool.query(
  `SELECT ts, rating FROM check_ins WHERE user_id::text = $1 ORDER BY ts DESC LIMIT 5`,
  [userId]
).catch(e => { console.log('check_ins err:', e.message); return { rows: [] }; })).rows;
console.log('\n— check-ins (last 5) —');
console.log(ci);

await pool.end();
