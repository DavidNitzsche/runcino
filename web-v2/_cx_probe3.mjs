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

// Silence design: notification volume + categories last 30d
await q('notif 30d by category', `SELECT category, COUNT(*) AS n, SUM(CASE WHEN delivered THEN 1 ELSE 0 END) AS delivered, MAX(fired_at)::date AS last FROM notifications_log WHERE COALESCE(user_uuid,user_id)=$1 AND fired_at > now() - interval '30 days' GROUP BY category ORDER BY n DESC`, [U]);
await q('notif recent payloads', `SELECT category, payload->'aps'->'alert' AS alert, fired_at::date AS d, delivered FROM notifications_log WHERE COALESCE(user_uuid,user_id)=$1 ORDER BY fired_at DESC LIMIT 12`, [U]);
await q('notif alltime by category', `SELECT category, COUNT(*) AS n FROM notifications_log WHERE COALESCE(user_uuid,user_id)=$1 GROUP BY category ORDER BY n DESC`, [U]);

// RPE usage
await q('post_run_rpe recent', `SELECT rpe, notes, logged_at::date AS d FROM post_run_rpe WHERE COALESCE(user_uuid,user_id)=$1 ORDER BY logged_at DESC LIMIT 10`, [U]);
await q('post_run_rpe count', `SELECT COUNT(*) AS n, MAX(logged_at) AS last FROM post_run_rpe WHERE COALESCE(user_uuid,user_id)=$1`, [U]);

// briefings cache: recent payloads
await q('briefings recent', `SELECT surface, mode, generated_at::date AS d FROM briefings WHERE COALESCE(user_uuid,user_id)=$1 ORDER BY generated_at DESC LIMIT 10`, [U]);
await q('coach_reads_cache kinds', `SELECT read_kind, COUNT(*) AS n, MAX(computed_at)::date AS last FROM coach_reads_cache WHERE COALESCE(user_uuid,user_id)=$1 GROUP BY read_kind ORDER BY last DESC`, [U]);
await pool.end();
