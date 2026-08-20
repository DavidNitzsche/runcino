// One-shot: execute David's approved Tier-1 backfill (single run). Reversible.
// Inverse: UPDATE runs SET shoe_id=NULL, shoe_auto_assigned_at=NULL WHERE id=-1466010895152803 AND user_uuid='...';
import fs from 'node:fs';
import pg from 'pg';
const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const DB_URL = (env.match(/^DATABASE_URL=(.*)$/m)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
if (!DB_URL) { console.error('no DATABASE_URL'); process.exit(1); }
const pool = new pg.Pool({ connectionString: DB_URL });
const c = await pool.connect();
try {
  console.log('connected as:', (await c.query('SELECT current_user')).rows[0].current_user);
  await c.query('BEGIN');
  const upd = await c.query(
    `UPDATE runs SET shoe_id = 1, shoe_auto_assigned_at = NOW()
       WHERE id = -1466010895152803
       AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'
       AND shoe_id IS NULL`,
  );
  console.log('rows updated:', upd.rowCount);
  const v = (await c.query(
    `SELECT id::text AS id, shoe_id, (shoe_auto_assigned_at IS NOT NULL) AS stamped,
            to_char(shoe_auto_assigned_at,'YYYY-MM-DD HH24:MI') AS at
       FROM runs WHERE id = -1466010895152803`,
  )).rows[0];
  if (upd.rowCount === 1 && Number(v.shoe_id) === 1 && v.stamped) {
    await c.query('COMMIT');
    console.log('COMMITTED ✓');
  } else {
    await c.query('ROLLBACK');
    console.log('ROLLED BACK — unexpected result, no change made');
  }
  console.log('post-write row:', JSON.stringify(v));
} catch (e) {
  await c.query('ROLLBACK').catch(() => {});
  console.error('ERROR — rolled back:', e.message);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
