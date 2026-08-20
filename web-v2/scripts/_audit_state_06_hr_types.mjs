// STATE AUDIT · Part 1.4: maxHr resolution, workoutType labeling, Sombrero, plan dump. RO.
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL_RO, ssl: { rejectUnauthorized: false } });
const UID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

console.log('=== profile HR fields ===');
console.table((await pool.query(`SELECT hrmax, hrmax_observed, lthr, lthr_method, rhr, vo2max_apple FROM profile WHERE user_uuid=$1`, [UID])).rows);

console.log('\n=== max hr observed across runs (top 5) ===');
console.table((await pool.query(
  `SELECT COALESCE(data->>'date', LEFT(data->>'startLocal',10)) AS day, data->>'maxHr' AS max_hr, data->>'avgHr' AS avg_hr, ROUND((data->>'distanceMi')::numeric,1) AS mi
     FROM runs WHERE user_uuid=$1 AND NOT (data ? 'mergedIntoId') AND data->>'maxHr' IS NOT NULL
    ORDER BY (data->>'maxHr')::numeric DESC LIMIT 5`, [UID])).rows);

console.log('\n=== workoutType field presence on runs ===');
console.table((await pool.query(
  `SELECT data->>'workoutType' AS workout_type, COUNT(*) AS n
     FROM runs WHERE user_uuid=$1 AND NOT (data ? 'mergedIntoId')
    GROUP BY 1 ORDER BY 2 DESC`, [UID])).rows);

console.log('\n=== data keys on the Jun 9 tempo run (canonical watch row) ===');
const jun9 = (await pool.query(
  `SELECT id, data FROM runs WHERE user_uuid=$1 AND NOT (data ? 'mergedIntoId') AND COALESCE(data->>'date', LEFT(data->>'startLocal',10))='2026-06-09' ORDER BY (data->>'distanceMi')::numeric DESC LIMIT 1`, [UID])).rows[0];
console.log('id:', jun9?.id, '\nkeys:', Object.keys(jun9?.data ?? {}).sort().join(', '));
const d = jun9?.data ?? {};
console.log('\nJun 9 run summary:', JSON.stringify({
  date: d.date, name: d.name, distanceMi: d.distanceMi, durationSec: d.durationSec,
  avgPaceMinPerMi: d.avgPaceMinPerMi, avgHr: d.avgHr, maxHr: d.maxHr, workoutType: d.workoutType,
  splits_unreliable: d.splits_unreliable, tempF: d.tempF, weather: d.weather,
}, null, 1));
console.log('\nJun 9 splits:', JSON.stringify(d.splits)?.slice(0, 800));

console.log('\n=== Sombrero + Big Sur actual results (key fields) ===');
for (const slug of ['sombrero-half', 'big-sur-marathon', 'disney-half-2026']) {
  const r = (await pool.query(`SELECT slug, actual_result->>'finishS' AS finish_s, actual_result->>'paceSPerMi' AS pace, actual_result->>'avgHr' AS avg_hr, actual_result->>'source' AS src, meta->>'distanceMi' AS dist FROM races WHERE user_uuid=$1 AND slug=$2`, [UID, slug])).rows[0];
  console.log(JSON.stringify(r));
}

console.log('\n=== plan_weeks for active plan pln_ca91f252bba50c74 ===');
console.table((await pool.query(
  `SELECT week_idx, week_start_iso, phase_id, is_cutback, is_peak, is_race_week FROM plan_weeks WHERE plan_id='pln_ca91f252bba50c74' ORDER BY week_idx`)).rows);

console.log('\n=== plan_phases ===');
console.table((await pool.query(
  `SELECT label, start_week_idx, end_week_idx FROM plan_phases WHERE plan_id='pln_ca91f252bba50c74' ORDER BY start_week_idx`)).rows);

console.log('\n=== weekly volume from plan_workouts ===');
console.table((await pool.query(
  `SELECT pw.week_id, MIN(pw.date_iso) AS week_start, ROUND(SUM(pw.distance_mi),1) AS mi,
          COUNT(*) FILTER (WHERE pw.type NOT IN ('rest')) AS run_days,
          COUNT(*) FILTER (WHERE pw.is_quality) AS quality_days,
          MAX(pw.distance_mi) FILTER (WHERE pw.is_long) AS long_mi
     FROM plan_workouts pw WHERE pw.plan_id='pln_ca91f252bba50c74'
    GROUP BY pw.week_id ORDER BY MIN(pw.date_iso)`)).rows);

await pool.end();
