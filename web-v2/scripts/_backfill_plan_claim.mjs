/**
 * Claim the legacy unclaimed training plan to David's UUID.
 * Plan 8599e3a1 is the active AFC-Half plan; was authored 2026-05-20
 * before the multi-tenant claim ran on this plan_id. Its user_id is 'me'
 * and user_uuid IS NULL — matches the legacy single-user pattern.
 *
 * Safe / idempotent / scoped: ONLY touches rows where user_id='me' AND
 * user_uuid IS NULL AND id matches the active plan. We are NOT mass-
 * claiming all legacy rows here (the bootstrap data-migration already
 * handles that for the rest).
 */
import { Pool } from 'pg';
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const ACTIVE_PLAN = '8599e3a1-07ab-4610-9f77-eae6a6f80032';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function q(sql, params=[]) { return (await pool.query(sql, params)); }
try {
  const before = (await q(`SELECT user_uuid::text AS u, user_id, archived_iso FROM training_plans WHERE id=$1`, [ACTIVE_PLAN])).rows[0];
  console.log('BEFORE:', JSON.stringify(before));
  if (before.u === DAVID) { console.log('Already claimed. Nothing to do.'); process.exit(0); }
  if (before.archived_iso) { console.log('Plan is archived. Aborting.'); process.exit(1); }

  await q('BEGIN');
  const r = await q(`UPDATE training_plans SET user_uuid=$1 WHERE id=$2 AND user_id='me' AND user_uuid IS NULL`, [DAVID, ACTIVE_PLAN]);
  console.log('plan rows updated:', r.rowCount);
  await q('COMMIT');

  const after = (await q(`SELECT user_uuid::text AS u, user_id FROM training_plans WHERE id=$1`, [ACTIVE_PLAN])).rows[0];
  console.log('AFTER:', JSON.stringify(after));
} catch (e) {
  console.error(e);
  await q('ROLLBACK').catch(() => {});
  process.exit(1);
} finally { await pool.end(); }
