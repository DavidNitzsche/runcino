import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const U = '0645f40c-951d-4ccc-b86e-9979cd26c795';
async function q(label, sql, params = []) {
  try {
    const r = await pool.query(sql, params);
    console.log('=== ' + label + ' (' + r.rows.length + ' rows) ===');
    console.log(JSON.stringify(r.rows, null, 1).slice(0, 9000));
  } catch (e) { console.log('=== ' + label + ' ERROR: ' + e.message); }
}

await q('notif payload sample', `SELECT category, payload, dedup_key, fired_at FROM notifications_log WHERE user_uuid=$1 ORDER BY fired_at DESC LIMIT 6`, [U]);
await q('race_eve dates', `SELECT fired_at::date AS d, COUNT(*) FROM notifications_log WHERE user_uuid=$1 AND category='race_eve' GROUP BY 1 ORDER BY 1 DESC LIMIT 15`, [U]);
await q('post_run_rpe recent', `SELECT rpe, notes, logged_at::date AS d FROM post_run_rpe WHERE user_uuid=$1 ORDER BY logged_at DESC LIMIT 10`, [U]);
await q('post_run_rpe count', `SELECT COUNT(*) AS n, MAX(logged_at) AS last FROM post_run_rpe WHERE user_uuid=$1`, [U]);
await q('coach_reads_cache kinds', `SELECT read_kind, COUNT(*) AS n, MAX(computed_at)::date AS last FROM coach_reads_cache WHERE user_uuid=$1 GROUP BY read_kind ORDER BY last DESC LIMIT 20`, [U]);
await q('check_ins for david', `SELECT ts::date AS d, rating, note, surface FROM check_ins WHERE user_uuid=$1 ORDER BY ts DESC LIMIT 10`, [U]);
await q('daily_checkin', `SELECT * FROM daily_checkin ORDER BY 1 DESC LIMIT 3`, []);
await pool.end();
