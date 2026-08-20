import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL_RO, ssl: { rejectUnauthorized: false } });

const t = await pool.query(`SELECT table_name, table_type FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`);
console.log('=== TABLES/VIEWS ===');
for (const r of t.rows) console.log(`${r.table_type === 'VIEW' ? 'V' : 'T'}  ${r.table_name}`);

for (const tbl of ['user_profile', 'users', 'runner_profile', 'profile']) {
  const c = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`, [tbl]);
  if (c.rows.length) console.log(`\n${tbl}: ${c.rows.map(r => r.column_name).join(', ')}`);
}
await pool.end();
