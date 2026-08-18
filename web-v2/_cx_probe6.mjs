import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const U = '0645f40c-951d-4ccc-b86e-9979cd26c795';
async function q(label, sql, params = []) {
  try {
    const r = await pool.query(sql, params);
    console.log('=== ' + label + ' (' + r.rows.length + ' rows) ===');
    console.log(JSON.stringify(r.rows, null, 1).slice(0, 6000));
  } catch (e) { console.log('=== ' + label + ' ERROR: ' + e.message); }
}
await q('plan_adapt intents', `SELECT reason, COUNT(*) AS n, MAX(ts)::date AS last FROM coach_intents WHERE COALESCE(user_uuid::text,user_id)=$1 AND reason LIKE 'plan_adapt%' GROUP BY reason`, [U]);
await q('plan_adapt samples', `SELECT reason, value, ts::date FROM coach_intents WHERE COALESCE(user_uuid::text,user_id)=$1 AND reason LIKE 'plan_adapt%' ORDER BY ts DESC LIMIT 5`, [U]);
await q('intent reasons all', `SELECT reason, COUNT(*) AS n, MAX(ts)::date AS last FROM coach_intents WHERE COALESCE(user_uuid::text,user_id)=$1 GROUP BY reason ORDER BY n DESC LIMIT 20`, [U]);
await pool.end();
