import { Pool } from 'pg';
const url = process.env.DATABASE_URL;
if (!url) { console.error('NO_URL'); process.exit(1); }
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 2 });
try {
  const t = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' ORDER BY table_name;
  `);
  console.log('TABLES:');
  for (const r of t.rows) console.log('  ' + r.table_name);
  const u = await pool.query(`SELECT id, email, name, status, is_admin, created_at FROM users WHERE LOWER(email)='dnitch85@me.com'`).catch(e=>({rows:[],err:e.message}));
  console.log('\nDAVID_USERS_ROW:', JSON.stringify(u.rows, null, 2), u.err ? '(err: '+u.err+')' : '');
} catch (e) {
  console.error('ERR', e.message);
} finally { await pool.end(); }
