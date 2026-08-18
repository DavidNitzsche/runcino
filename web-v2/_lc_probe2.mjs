import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const uid = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const q = (sql, p) => pool.query(sql, p).then(r => r.rows).catch(e => [{ ERROR: e.message }]);

console.log('PROPOSAL 44 FULL:', JSON.stringify(await q(
  `SELECT id, proposal_kind, status, source, plan_id, new_plan_id, reasons, created_at::text
     FROM plan_proposals WHERE user_uuid=$1 AND id IN (44,42) ORDER BY id DESC`, [uid]), null, 1));

console.log('NOTIF PENDING:', JSON.stringify(await q(
  `SELECT category, fire_at::text, processed_at::text, dedup_key FROM notifications_pending
    WHERE user_uuid::text=$1 ORDER BY created_at DESC LIMIT 8`, [uid]), null, 1));

console.log('NOTIF LOG:', JSON.stringify(await q(
  `SELECT category, fired_at::text, delivered, dedup_key FROM notifications_log
    WHERE user_uuid::text=$1 ORDER BY fired_at DESC LIMIT 10`, [uid]), null, 1));

await pool.end();
