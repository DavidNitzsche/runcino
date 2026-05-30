/**
 * Verify every row David should own has user_uuid set.
 * If any have user_id='me' AND user_uuid IS NULL, we can't safely drop
 * the OR fallback patterns yet.
 */
import { Pool } from 'pg';
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const TABLES = [
  ['profile', 'user_uuid'],
  ['user_prefs', 'user_uuid'],
  ['training_plans', 'user_uuid'],
  ['races', 'user_uuid'],
  ['daily_checkin', 'user_uuid'],
  ['personal_goals', 'user_uuid'],
  ['skipped_workouts', 'user_uuid'],
  ['recovery_sessions', 'user_uuid'],
  ['shoes', 'user_uuid'],
  ['strava_activities', 'user_uuid'],
];

try {
  console.log('=== Unclaimed legacy "me" rows (user_uuid IS NULL AND user_id=\'me\') ===');
  for (const [tbl, _col] of TABLES) {
    // Check if the table has user_id column at all
    const hasUserId = await pool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='user_id'`,
      [tbl]
    );
    if (hasUserId.rowCount === 0) {
      console.log(`  ${tbl.padEnd(25)} → no user_id column (skip)`);
      continue;
    }
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n FROM ${tbl} WHERE user_uuid IS NULL AND user_id::text = 'me'`
    ).catch(e => ({ rows: [{ err: e.message }] }));
    const n = r.rows[0]?.n ?? 0;
    const flag = n > 0 ? '⚠️  UNCLAIMED' : '✓';
    console.log(`  ${tbl.padEnd(25)} → ${n} unclaimed${flag === '⚠️  UNCLAIMED' ? ' ' + flag : ' ' + flag}`);
  }

  console.log('\n=== David rows by user_uuid (sanity check — should be > 0 each) ===');
  for (const [tbl, _col] of TABLES) {
    const r = await pool.query(`SELECT COUNT(*)::int AS n FROM ${tbl} WHERE user_uuid = $1`, [DAVID]).catch(() => ({ rows: [{ n: 'err' }] }));
    console.log(`  ${tbl.padEnd(25)} → ${r.rows[0].n}`);
  }
} catch (e) { console.error(e); }
finally { await pool.end(); }
