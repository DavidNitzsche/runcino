import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
try {
  const c = await pool.query(`SELECT COUNT(*) FROM profile`);
  console.log('profile rows:', c.rows[0]);
  const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='profile' ORDER BY 1`);
  console.log('cols:', cols.rows.map(r => r.column_name).join(', '));
  const s = await pool.query(`SELECT lthr, max_hr FROM profile LIMIT 3`).catch(e => String(e));
  console.log('sample:', JSON.stringify(s.rows ?? s));
} catch (e) { console.log('ERR', String(e)); }
// planned type distribution for days where a run landed
const t = await pool.query(`
  SELECT pw.type, COUNT(*) n FROM plan_workouts pw
   JOIN training_plans tp ON tp.id = pw.plan_id
   JOIN runs r ON r.user_uuid = tp.user_uuid AND r.data->>'date' = pw.date_iso
  GROUP BY 1 ORDER BY n DESC`).catch(e => ({ rows: [], e: String(e) }));
console.table(t.rows);
await pool.end();
