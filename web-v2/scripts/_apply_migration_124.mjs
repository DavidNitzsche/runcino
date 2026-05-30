import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
try {
  const sql = readFileSync('db/migrations/124_projection_snapshots.sql', 'utf8');
  await pool.query(sql);
  const cols = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='projection_snapshots' ORDER BY ordinal_position`);
  console.log('Migration applied. projection_snapshots columns:');
  for (const c of cols.rows) console.log(`  ${c.column_name.padEnd(20)} ${c.data_type}`);
  const count = await pool.query(`SELECT COUNT(*)::int AS c FROM projection_snapshots`);
  console.log('Existing rows:', count.rows[0].c);
} catch (e) { console.error(e); process.exit(1); }
finally { await pool.end(); }
