// GATED OPS · approved by David 2026-06-09 ("GO · OP-1 yes · OP-2 yes ·
// OP-3 okay · Q1 different shoes · Q2 zoom flys + vomero plus retire").
// Each op runs in its own transaction with a row-count assertion;
// mismatch → ROLLBACK + report. WRITE role (explicitly approved).
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const UID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

async function op(name, expect, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const count = await fn(client);
    if (count !== expect) {
      await client.query('ROLLBACK');
      console.log(`✗ ${name}: rowCount ${count} ≠ expected ${expect} → ROLLED BACK`);
      return false;
    }
    await client.query('COMMIT');
    console.log(`✓ ${name}: ${count} row(s)`);
    return true;
  } catch (e) {
    await client.query('ROLLBACK');
    console.log(`✗ ${name}: ${e.message} → ROLLED BACK`);
    return false;
  } finally {
    client.release();
  }
}

// OP-1 · race row 407 → 412 + spec band 407-417 + hr_cap 162
await op('OP-1 race row 6:47→6:52', 1, async (c) => (await c.query(
  `UPDATE plan_workouts
      SET pace_target_s_per_mi = 412,
          workout_spec = jsonb_set(jsonb_set(jsonb_set(workout_spec,
            '{pace_target_s_per_mi_lo}', '407'),
            '{pace_target_s_per_mi_hi}', '417'),
            '{hr_cap_bpm}', '162')
    WHERE plan_id = 'pln_ca91f252bba50c74'
      AND type = 'race' AND date_iso = '2026-08-16'
      AND pace_target_s_per_mi = 407`,
)).rowCount);

// OP-2 · Aug 11 easy → race-week tune-up
await op('OP-2 Aug 11 tune-up', 1, async (c) => (await c.query(
  `UPDATE plan_workouts
      SET type = 'race_week_tuneup',
          distance_mi = 5,
          is_quality = true,
          pace_target_s_per_mi = 412,
          sub_label = '4×1km @ race pace · 90s jog',
          notes = 'Race-pace primer, 5 days out. Hold goal pace, even reps, stop at 4. Confidence check, not a workout. Pass: reps at 6:52/mi with avgHr <= 158.',
          workout_spec = '{"kind":"threshold","warmup_mi":1.5,"rep_count":4,"rep_distance_mi":0.62,"rep_pace_s_per_mi":412,"rep_rest_s":90,"cooldown_mi":1.0,"lthr_bpm":162}'::jsonb
    WHERE plan_id = 'pln_ca91f252bba50c74'
      AND date_iso = '2026-08-11' AND type = 'easy'`,
)).rowCount);

// OP-3 · AFC gun time · guarded set-if-null (if David already tapped the
// chip, his value stands)
await op('OP-3 AFC gun time 7:00 AM (if unset)', 1, async (c) => (await c.query(
  `UPDATE races
      SET meta = jsonb_set(meta, '{startTime}', '"7:00 AM"')
    WHERE user_uuid = $1::uuid AND slug = 'americas-finest-city'
      AND (meta->>'startTime') IS NULL`,
  [UID],
)).rowCount);

// Q2 · retire Zoom Fly 6 (id 4) + Vomero Plus (id 5)
await op('Q2 retire Zoom Fly 6', 1, async (c) => (await c.query(
  `UPDATE shoes SET retired = true WHERE user_uuid = $1::uuid AND id = 4 AND retired = false`, [UID],
)).rowCount);
await op('Q2 retire Vomero Plus', 1, async (c) => (await c.query(
  `UPDATE shoes SET retired = true WHERE user_uuid = $1::uuid AND id = 5 AND retired = false`, [UID],
)).rowCount);

// Q1 · different shoes → no merge · no-op by decision (recorded here).
console.log('· Q1: shoes 1 + 6 confirmed DIFFERENT pairs · no merge, names stand (editable in UI).');

// Verify final state (read-back)
const v = await pool.query(
  `SELECT date_iso, type, pace_target_s_per_mi,
          workout_spec->>'pace_target_s_per_mi_lo' AS lo,
          workout_spec->>'pace_target_s_per_mi_hi' AS hi,
          workout_spec->>'hr_cap_bpm' AS hr_cap, sub_label
     FROM plan_workouts
    WHERE plan_id = 'pln_ca91f252bba50c74' AND date_iso IN ('2026-08-11','2026-08-16')
    ORDER BY date_iso`,
);
console.table(v.rows);
const r2 = await pool.query(
  `SELECT slug, meta->>'startTime' AS gun FROM races WHERE user_uuid=$1::uuid AND slug='americas-finest-city'`, [UID]);
console.table(r2.rows);
const s2 = await pool.query(`SELECT id, brand, model, retired FROM shoes WHERE user_uuid=$1::uuid ORDER BY id`, [UID]);
console.table(s2.rows);
await pool.end();
