import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const U = '0645f40c-951d-4ccc-b86e-9979cd26c795';

async function q(label, sql, params = []) {
  try {
    const r = await pool.query(sql, params);
    console.log('=== ' + label + ' (' + r.rows.length + ' rows) ===');
    console.log(JSON.stringify(r.rows, null, 1).slice(0, 6000));
  } catch (e) {
    console.log('=== ' + label + ' ERROR: ' + e.message);
  }
}

// 1. What brief/cache tables exist
await q('tables', `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name ILIKE '%brief%' OR table_name ILIKE '%coach%' OR table_name ILIKE '%notif%' OR table_name ILIKE '%checkin%' OR table_name ILIKE '%check_in%' OR table_name ILIKE '%rpe%') ORDER BY 1`);

// 2. notifications last 30 days
await q('notifications 30d', `SELECT kind, COUNT(*) AS n, MAX(created_at)::date AS last FROM notifications_log WHERE user_uuid=$1 AND created_at > now() - interval '30 days' GROUP BY kind ORDER BY n DESC`, [U]);
await q('notifications recent bodies', `SELECT kind, title, body, created_at::date AS d, status FROM notifications_log WHERE user_uuid=$1 ORDER BY created_at DESC LIMIT 15`, [U]);

// 3. subjective checkins / rpe
await q('subjective_checkins recent', `SELECT * FROM subjective_checkins WHERE user_uuid=$1 ORDER BY 1 DESC LIMIT 5`, [U]);
await q('subjective_checkins count', `SELECT COUNT(*) AS total, MAX(created_at) AS last FROM subjective_checkins WHERE user_uuid=$1`, [U]);
await q('post_run_rpe', `SELECT COUNT(*) AS total, MAX(created_at) AS last FROM post_run_rpe WHERE user_uuid=$1`, [U]);
await q('check_ins', `SELECT COUNT(*) AS total FROM check_ins`, []);

await pool.end();
