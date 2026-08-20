import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const U = '0645f40c-951d-4ccc-b86e-9979cd26c795';
async function q(label, sql, params = []) {
  try {
    const r = await pool.query(sql, params);
    console.log('=== ' + label + ' (' + r.rows.length + ' rows) ===');
    console.log(JSON.stringify(r.rows, null, 1).slice(0, 8000));
  } catch (e) { console.log('=== ' + label + ' ERROR: ' + e.message); }
}

await q('notif cols', `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='notifications_log' ORDER BY ordinal_position`);
await q('rpe cols', `SELECT column_name FROM information_schema.columns WHERE table_name='post_run_rpe' ORDER BY ordinal_position`);
await q('briefings cols', `SELECT column_name FROM information_schema.columns WHERE table_name='briefings' ORDER BY ordinal_position`);
await q('coach_reads_cache cols', `SELECT column_name FROM information_schema.columns WHERE table_name='coach_reads_cache' ORDER BY ordinal_position`);
await q('check_ins cols', `SELECT column_name FROM information_schema.columns WHERE table_name='check_ins' ORDER BY ordinal_position`);
await pool.end();
