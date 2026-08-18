// READ-ONLY retro probe 2: planned vs executed week by week + workouts + mutations
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const uid = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const planId = 'pln_ca91f252bba50c74';

// full authored_state
const plan = await pool.query(`SELECT authored_state FROM training_plans WHERE id=$1`, [planId]);
console.log('=== authored_state (full) ===');
console.log(JSON.stringify(plan.rows[0].authored_state, null, 1));

// all plan workouts
const w = await pool.query(`SELECT w.id, pw.week_idx, w.date_iso, w.dow, w.type, w.sub_label,
    w.distance_mi, w.pace_target_s_per_mi, w.duration_min, w.is_quality, w.is_long,
    w.original_date_iso, w.original_type, w.original_distance_mi, w.original_sub_label
  FROM plan_workouts w JOIN plan_weeks pw ON pw.id = w.week_id
  WHERE w.plan_id=$1 ORDER BY w.date_iso, w.id`, [planId]);
console.log('\n=== plan_workouts (' + w.rows.length + ') ===');
for (const r of w.rows) {
  const mut = (r.original_date_iso || r.original_type || r.original_distance_mi || r.original_sub_label)
    ? ` [ORIG date=${r.original_date_iso ?? '-'} type=${r.original_type ?? '-'} mi=${r.original_distance_mi ?? '-'} sub=${r.original_sub_label ?? '-'}]` : '';
  console.log(`wk${r.week_idx} ${r.date_iso} ${r.type}${r.sub_label ? '/'+r.sub_label : ''} ${r.distance_mi ?? ''}mi pace=${r.pace_target_s_per_mi ?? '-'} q=${r.is_quality?1:0} L=${r.is_long?1:0}${mut} id=${r.id}`);
}

// runs in the block window
const runs = await pool.query(`SELECT id,
    COALESCE(data->>'date', LEFT(data->>'startLocal',10)) AS d,
    ROUND((data->>'distanceMi')::numeric,2) AS mi,
    (data->>'movingTimeS')::int AS s,
    ROUND((data->>'avgHr')::numeric) AS hr,
    data->>'source' AS src,
    data->>'workoutType' AS wtype
  FROM runs
  WHERE user_uuid=$1::uuid AND NOT (data ? 'mergedIntoId')
    AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) BETWEEN '2026-06-01' AND '2026-08-16'
  ORDER BY d`, [uid]);
console.log('\n=== runs (' + runs.rows.length + ') ===');
for (const r of runs.rows) {
  const pace = r.mi > 0 && r.s ? Math.round(r.s / r.mi) : null;
  const pf = pace ? `${Math.floor(pace/60)}:${String(pace%60).padStart(2,'0')}/mi` : '-';
  console.log(`${r.d} ${r.mi}mi ${r.s}s ${pf} hr=${r.hr ?? '-'} src=${r.src} type=${r.wtype ?? '-'} id=${r.id}`);
}

// plan_mutations
const m = await pool.query(`SELECT m.id, m.workout_id, m.ts, m.reason, m.trigger_kind, m.status, m.changed_fields, m.citation
  FROM plan_mutations m
  WHERE m.user_uuid=$1::uuid AND m.workout_id IN (SELECT id FROM plan_workouts WHERE plan_id=$2)
  ORDER BY m.ts`, [uid, planId]);
console.log('\n=== plan_mutations (' + m.rows.length + ') ===');
for (const r of m.rows) {
  console.log(`${r.ts.toISOString()} wk=${r.workout_id} kind=${r.trigger_kind} status=${r.status} reason=${r.reason}`);
  console.log('   changed:', JSON.stringify(r.changed_fields));
}

// completions
const c = await pool.query(`SELECT workout_id, status, total_distance_mi, total_duration_sec, avg_hr, source, completed_at
  FROM workout_completions WHERE user_uuid=$1::uuid AND workout_id IN (SELECT id FROM plan_workouts WHERE plan_id=$2)
  ORDER BY completed_at`, [uid, planId]);
console.log('\n=== workout_completions (' + c.rows.length + ') ===');
for (const r of c.rows) console.log(JSON.stringify(r));

// skipped
const sk = await pool.query(`SELECT date, planned_workout_type, planned_mi, reason, ts FROM skipped_workouts
  WHERE user_uuid=$1::uuid AND date BETWEEN '2026-06-01' AND '2026-08-16' ORDER BY date`, [uid]);
console.log('\n=== skipped_workouts (' + sk.rows.length + ') ===');
for (const r of sk.rows) console.log(JSON.stringify(r));

await pool.end();
