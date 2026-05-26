import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='briefings' ORDER BY ordinal_position`);
console.log('briefings cols:', cols.rows.map(r=>r.column_name).join(', '));
console.log();
const r = await pool.query(`SELECT * FROM briefings
                             WHERE user_id::text='0645f40c-951d-4ccc-b86e-9979cd26c795'`);
console.log('Briefings rows:', r.rowCount);
for (const row of r.rows) {
  const voice = String(row.payload?.voice ?? '').slice(0, 220);
  console.log(`  surface=${row.surface} generated_at=${row.generated_at}`);
  console.log(`    voice: ${voice}`);
}
await pool.end();
