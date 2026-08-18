// RO probe · verdict-lthr wave1 · confirm shapes loadRecentTestPoints relies on:
// runs.data.splits key names, workout_spec presence, splits_unreliable flag.
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = await pool.query(`
  SELECT pw.date_iso, pw.type, pw.distance_mi, pw.pace_target_s_per_mi,
         pw.workout_spec IS NOT NULL AS has_spec,
         pw.workout_spec->>'kind' AS spec_kind,
         r.data->>'distanceMi' AS dist_actual,
         r.data->>'durationSec' AS dur_s,
         (r.data->>'splits_unreliable') AS splits_unreliable,
         jsonb_array_length(COALESCE(r.data->'splits','[]'::jsonb)) AS n_splits,
         r.data->'splits'->0 AS split0
    FROM plan_workouts pw
    JOIN training_plans tp ON tp.id = pw.plan_id
    JOIN runs r ON r.user_uuid = tp.user_uuid AND r.data->>'date' = pw.date_iso
     AND NOT (r.data ? 'mergedIntoId') AND r.absorbed_into_canonical_at IS NULL
   WHERE pw.type IN ('tempo','threshold','intervals','long','race_week_tuneup')
   ORDER BY pw.date_iso DESC LIMIT 8`);
for (const r of q.rows) {
  console.log(r.date_iso, r.type, 'spec:', r.spec_kind, 'target:', r.pace_target_s_per_mi,
    'plan_mi:', r.distance_mi, 'act_mi:', r.dist_actual, 'dur:', r.dur_s,
    'unrel:', r.splits_unreliable, 'nsplits:', r.n_splits);
  if (r.split0) console.log('   split0 keys:', Object.keys(r.split0).join(','), JSON.stringify(r.split0).slice(0,200));
}
await pool.end();
