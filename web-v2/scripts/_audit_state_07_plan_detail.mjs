// STATE AUDIT · Part 2 prep: full plan dump w/ paces + splits_unreliable VALUES + Jun 10 workout. RO.
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL_RO, ssl: { rejectUnauthorized: false } });
const UID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const fmt = (s) => s == null ? null : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

console.log('=== ACTIVE PLAN pln_ca91f252bba50c74 · all workouts Jun 9 → race ===');
const wos = (await pool.query(
  `SELECT date_iso, dow, type, distance_mi, pace_target_s_per_mi, duration_min, is_quality, is_long, sub_label, notes,
          original_type, original_distance_mi, original_sub_label,
          workout_spec IS NOT NULL AS has_spec
     FROM plan_workouts WHERE plan_id='pln_ca91f252bba50c74' AND date_iso >= '2026-06-08'
    ORDER BY date_iso`)).rows;
for (const w of wos) {
  const adapted = (w.original_type && w.original_type !== w.type) || (w.original_sub_label && w.original_sub_label !== w.sub_label);
  console.log(`${w.date_iso} ${String(w.type).padEnd(10)} ${String(w.distance_mi ?? '·').padStart(5)}mi  pace=${fmt(w.pace_target_s_per_mi) ?? '··'}  ${w.is_quality ? 'Q' : ' '}${w.is_long ? 'L' : ' '}  ${w.sub_label ?? ''}${adapted ? `  [ADAPTED from ${w.original_type}${w.original_sub_label ? ' · ' + w.original_sub_label : ''}]` : ''}${w.notes ? `  notes: ${String(w.notes).slice(0, 60)}` : ''}`);
}

console.log('\n=== splits_unreliable actual VALUES on last 12 runs ===');
console.table((await pool.query(
  `SELECT COALESCE(data->>'date', LEFT(data->>'startLocal',10)) AS day, data->>'source' AS src,
          ROUND((data->>'distanceMi')::numeric,2) AS mi,
          jsonb_array_length(COALESCE(data->'splits','[]'::jsonb)) AS n_splits,
          data->>'splits_unreliable' AS unreliable_value,
          LEFT(data->>'splits_validation', 70) AS validation
     FROM runs WHERE user_uuid=$1 AND NOT (data ? 'mergedIntoId')
    ORDER BY COALESCE(data->>'date', LEFT(data->>'startLocal',10)) DESC LIMIT 12`, [UID])).rows);

console.log('\n=== Jun 10 (tomorrow) full workout_spec ===');
const tmrw = (await pool.query(
  `SELECT date_iso, type, distance_mi, pace_target_s_per_mi, sub_label, notes, workout_spec
     FROM plan_workouts WHERE plan_id='pln_ca91f252bba50c74' AND date_iso='2026-06-10'`)).rows[0];
console.log(JSON.stringify(tmrw, null, 1));

console.log('\n=== adaptation_log on active plan ===');
const alog = (await pool.query(`SELECT adaptation_log FROM training_plans WHERE id='pln_ca91f252bba50c74'`)).rows[0];
const entries = Array.isArray(alog?.adaptation_log) ? alog.adaptation_log : [];
console.log(`entries: ${entries.length}`);
for (const e of entries.slice(-8)) console.log(JSON.stringify(e).slice(0, 220));

console.log('\n=== Jun 9 plan day (yesterday tempo?) ===');
console.log(JSON.stringify((await pool.query(
  `SELECT date_iso, type, distance_mi, pace_target_s_per_mi, sub_label, notes FROM plan_workouts WHERE plan_id='pln_ca91f252bba50c74' AND date_iso IN ('2026-06-08','2026-06-09')`)).rows, null, 1));

await pool.end();
