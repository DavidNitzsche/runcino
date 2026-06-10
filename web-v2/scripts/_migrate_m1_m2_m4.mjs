// 2026-06-09 · REGRESSION FIXES · gated migrations M1 + M2 + M4.
// David's GO: 2026-06-09 ("1. GO · 2. your call · 4. yes").
// M2 scope (Claude's call per "your call"): race row ONLY — Aug 4/6 tempos
// and easy bands stay as trained (no mid-taper prescription surprises).
// Every statement keys on primary id / slug+user. Inverses in the recap.
import { Pool } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('no DATABASE_URL'); process.exit(1); }
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

// ── M1 · goalSafeDisplay "1:37" → "1:37:00" (goalDisplay already normalized)
const m1 = await pool.query(
  `UPDATE races SET meta = jsonb_set(meta, '{goalSafeDisplay}', '"1:37:00"')
    WHERE slug = 'americas-finest-city' AND user_uuid = $1
      AND meta->>'goalSafeDisplay' = '1:37'`,
  [DAVID],
);
console.log('M1 goalSafeDisplay rows:', m1.rowCount);

// ── M2 · race row: goal pace 412 ±5 band, HM HR cap = LTHR 162, gel-13 out
const m2 = await pool.query(
  `UPDATE plan_workouts SET
     pace_target_s_per_mi = 412,
     workout_spec = workout_spec || '{"pace_target_s_per_mi_lo":407,"pace_target_s_per_mi_hi":417,"hr_cap_bpm":162,"fuel_mi":[5,9]}'::jsonb
   WHERE id = 'wko_907063f1305256b9'
     AND pace_target_s_per_mi = 407`,
);
console.log('M2 race-row rows:', m2.rowCount);

// ── M4 · Aug 11 easy 3 → race_week_tuneup (Research/08 §9.3 · 4×1km @ race
//    pace · 90s jog · T−5d). Spec shape mirrors spec-builder's
//    race_week_tuneup branch with goal pace threaded (412). Total distance
//    per totalDistanceMiFromSpec: 1.5 + 4×0.62 + 3×(90/540) + 1.0 = 5.5.
const m4 = await pool.query(
  `UPDATE plan_workouts SET
     type = 'race_week_tuneup',
     distance_mi = 5.5,
     pace_target_s_per_mi = 412,
     is_quality = true,
     sub_label = '1.5 mi WU · 4×1km @ race pace · 90s jog · 1 mi CD',
     notes = 'Race tune-up. Hold 6:52 with HR at or under 162 and the race plan is locked in.',
     workout_spec = '{"kind":"threshold","warmup_mi":1.5,"rep_count":4,"rep_distance_mi":0.62,"rep_pace_s_per_mi":412,"rep_rest_s":90,"cooldown_mi":1.0,"lthr_bpm":162}'::jsonb
   WHERE id = 'wko_3898bfaaee531f97'
     AND type = 'easy'`,
);
console.log('M4 tune-up rows:', m4.rowCount);

// ── verify after-state
const after = await pool.query(
  `SELECT id, date_iso, type, distance_mi, pace_target_s_per_mi, sub_label, workout_spec
     FROM plan_workouts WHERE id IN ('wko_907063f1305256b9','wko_3898bfaaee531f97')`,
);
for (const r of after.rows) console.log('AFTER:', JSON.stringify(r));
const meta = await pool.query(
  `SELECT meta->>'goalDisplay' AS g, meta->>'goalSafeDisplay' AS gb
     FROM races WHERE slug='americas-finest-city' AND user_uuid=$1`, [DAVID]);
console.log('META AFTER:', JSON.stringify(meta.rows[0]));
await pool.end();
