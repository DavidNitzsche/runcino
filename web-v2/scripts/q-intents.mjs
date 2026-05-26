import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='coach_intents' ORDER BY ordinal_position`);
console.log('coach_intents cols:', cols.rows.map(r=>r.column_name).join(', '));
console.log();
const r = await pool.query(`SELECT * FROM coach_intents WHERE ts::date >= CURRENT_DATE - 2 ORDER BY ts DESC LIMIT 20`);
console.log('rows:', r.rowCount);
for (const row of r.rows) {
  const v = JSON.stringify(row).slice(0, 400);
  console.log(' ', v);
}
await pool.end();
