import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const uid = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const p = await pool.query(`SELECT id, created_at::text ca, proposal_kind, status, source, reasons->>'drift_kind' dk, LEFT(reasons->>'message',140) msg
  FROM plan_proposals WHERE user_uuid=$1 AND created_at>='2026-05-01' ORDER BY id DESC LIMIT 40`, [uid]);
for (const r of p.rows) console.log(r.ca, '#'+r.id, r.proposal_kind, r.status, r.source, 'drift='+r.dk, '::', r.msg);
console.log('total:', p.rows.length);
await pool.end();
