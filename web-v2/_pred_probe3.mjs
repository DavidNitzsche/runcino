import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const uid = '0645f40c-951d-4ccc-b86e-9979cd26c795';

for (const t of ['plan_proposals', 'coach_proposals']) {
  const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name=$1`, [t]);
  console.log(t, 'cols:', cols.rows.map(c=>c.column_name).join(','));
}
const p = await pool.query(`
  SELECT id, created_iso, kind, status, reasons
  FROM plan_proposals WHERE user_uuid=$1 ORDER BY id DESC LIMIT 30`, [uid]).catch(e=>({rows:[],err:e.message}));
if (p.err) console.log('err', p.err);
console.log('\n=== plan_proposals ===');
for (const r of p.rows) {
  const rs = r.reasons ? JSON.stringify(r.reasons).slice(0,200) : null;
  console.log(`${r.created_iso ?? ''} #${r.id} ${r.kind} ${r.status} ${rs}`);
}
await pool.end();
