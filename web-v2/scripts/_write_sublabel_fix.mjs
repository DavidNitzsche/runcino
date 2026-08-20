// APPROVED gated write (David per-statement GO 2026-06-08) — correct the
// stale sub_label on the 3 race-specific peak longs of pln_ca91f252bba50c74
// to match the stored finish_mi. Transactional: each UPDATE must affect
// exactly 1 row or the whole thing rolls back. Reversible (before-state
// printed for the inverse).
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g, '').trim();
const PLAN = 'pln_ca91f252bba50c74';
const UPDATES = [
  { date: '2026-07-19', label: 'LONG · 9mi @ HM' },
  { date: '2026-07-26', label: 'LONG · 10mi @ HM' },
  { date: '2026-08-02', label: 'LONG · 8mi @ HM' },
];
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });

const dates = UPDATES.map(u => u.date);
const selSql = `SELECT date_iso, sub_label,
                       (workout_spec->>'finish_mi') AS finish_mi,
                       (workout_spec->>'finish_label') AS finish_label
                  FROM plan_workouts
                 WHERE plan_id=$1 AND date_iso = ANY($2::text[])
                 ORDER BY date_iso`;

const client = await pool.connect();
try {
  console.log('current_user =', (await client.query('SELECT current_user')).rows[0].current_user);

  console.log('\n── BEFORE ──');
  for (const r of (await client.query(selSql, [PLAN, dates])).rows)
    console.log(`  ${r.date_iso}  sub_label="${r.sub_label}"   (spec finish_mi=${r.finish_mi} ${r.finish_label})`);

  console.log('\n── EXECUTING (transaction) ──');
  await client.query('BEGIN');
  for (const u of UPDATES) {
    const res = await client.query(
      `UPDATE plan_workouts SET sub_label=$1 WHERE plan_id=$2 AND date_iso=$3`,
      [u.label, PLAN, u.date]);
    console.log(`  ${u.date} → "${u.label}"   rows updated: ${res.rowCount}`);
    if (res.rowCount !== 1) {
      await client.query('ROLLBACK');
      throw new Error(`ABORT: ${u.date} affected ${res.rowCount} rows (expected 1) — rolled back, NOTHING committed`);
    }
  }
  await client.query('COMMIT');
  console.log('  COMMIT — all 3 rows updated, exactly 1 each.');

  console.log('\n── AFTER ──');
  for (const r of (await client.query(selSql, [PLAN, dates])).rows)
    console.log(`  ${r.date_iso}  sub_label="${r.sub_label}"   (spec finish_mi=${r.finish_mi} ${r.finish_label})  ${r.sub_label === `LONG · ${r.finish_mi}mi @ ${r.finish_label}` ? '✓ matches spec' : '✗ MISMATCH'}`);
} finally {
  client.release();
  await pool.end();
}
