// REGRESSION AUDIT 2026-06-09 · read-only edge-case sweep for the three
// fix batches (UI / STATE / ADVERSARIAL). Mirrors _audit_ro.mjs guard:
// refuses any connection that is not the faff_readonly role.
import { Pool } from 'pg';

const url = process.env.DATABASE_URL_RO;
if (!url || !/faff_readonly/.test(url)) {
  console.error('REFUSED: DATABASE_URL_RO must name faff_readonly');
  process.exit(1);
}
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
const q = async (label, sql, params = []) => {
  try {
    const r = await pool.query(sql, params);
    console.log(`\n=== ${label} (${r.rows.length} rows) ===`);
    for (const row of r.rows.slice(0, 40)) console.log(JSON.stringify(row));
  } catch (e) {
    console.log(`\n=== ${label} ERROR: ${e.message} ===`);
  }
};

const who = await pool.query('SELECT current_user');
console.log('connected as:', who.rows[0].current_user);

const DAVID = (await pool.query(`SELECT user_uuid FROM races WHERE slug='americas-finest-city' LIMIT 1`)).rows[0]?.user_uuid;
console.log('david uuid:', DAVID);

// 1 · workoutType distribution (baseline for the stamping migration)
await q('1 workoutType distribution (all runs)', `
  SELECT COALESCE(data->>'workoutType','<null>') AS wt,
         COALESCE(data->>'workoutTypeSource','<none>') AS src_label,
         COALESCE(data->>'source','<null>') AS source,
         COUNT(*) AS n
    FROM runs
   GROUP BY 1,2,3 ORDER BY n DESC`);

// 2 · goalDisplay formats on every race (which rows the old parsers break)
await q('2 race goal strings', `
  SELECT slug, meta->>'date' AS date, meta->>'priority' AS pri,
         meta->>'goalDisplay' AS goal, meta->>'goalSafeDisplay' AS goal_b,
         meta->>'startTimeLocal' AS start_local, meta->>'startTime' AS start_t,
         meta->>'waveTime' AS wave, meta->>'gunTimeIso' AS gun,
         (actual_result IS NOT NULL) AS has_result
    FROM races ORDER BY meta->>'date'`);

// 3 · active plan race row (stored pace vs code fix)
await q('3 active plan race row', `
  SELECT pw.id, pw.date_iso, pw.type, pw.distance_mi, pw.pace_target_s_per_mi,
         pw.workout_spec, pw.sub_label
    FROM plan_workouts pw JOIN training_plans tp ON tp.id = pw.plan_id
   WHERE tp.user_uuid = $1::uuid AND tp.archived_iso IS NULL AND pw.type = 'race'`, [DAVID]);

// 4 · distinct plan workout types + phase labels (old/new label drift)
await q('4 plan_workouts types (active plan)', `
  SELECT pw.type, COUNT(*) FROM plan_workouts pw
   JOIN training_plans tp ON tp.id = pw.plan_id
  WHERE tp.user_uuid=$1::uuid AND tp.archived_iso IS NULL GROUP BY 1 ORDER BY 2 DESC`, [DAVID]);
await q('4b phase labels (all plans incl archived)', `
  SELECT DISTINCT ph.label FROM plan_phases ph`);
await q('4c taper/race-week rows Aug 3-16', `
  SELECT pw.date_iso, pw.type, pw.distance_mi, pw.pace_target_s_per_mi, pw.sub_label
    FROM plan_workouts pw JOIN training_plans tp ON tp.id=pw.plan_id
   WHERE tp.user_uuid=$1::uuid AND tp.archived_iso IS NULL
     AND pw.date_iso >= '2026-08-03' ORDER BY pw.date_iso`, [DAVID]);

// 5 · runs in the 180d VDOT window: which NEWLY qualify under the COALESCE gate
await q('5 newly-qualifying VDOT run candidates (180d)', `
  SELECT id, data->>'date' AS date, data->>'source' AS source,
         (data->>'distanceMi')::numeric AS mi,
         (data->>'avgHr')::numeric AS avg_hr,
         (data->>'movingTimeS')::numeric AS moving_time_s,
         (data->>'durationSec')::numeric AS duration_sec,
         (data->>'timeMoving')::numeric AS time_moving,
         COALESCE(data->>'workoutType','') AS wt,
         data->'provenance'->>'avgHr' AS prov_avg_hr,
         ROUND(COALESCE((data->>'durationSec')::numeric,(data->>'movingTimeS')::numeric,
               (data->>'movingSec')::numeric,(data->>'timeMoving')::numeric,
               (data->>'elapsedTimeS')::numeric) / NULLIF((data->>'distanceMi')::numeric,0)) AS pace_s_mi
    FROM runs
   WHERE user_uuid = $1::uuid
     AND data->>'mergedIntoId' IS NULL
     AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) >= '2025-12-12'
     AND (data->>'distanceMi')::numeric >= 4
     AND (data->>'movingTimeS') IS NULL  -- previously EXCLUDED rows only
     AND COALESCE((data->>'durationSec')::numeric,(data->>'movingSec')::numeric,
                  (data->>'timeMoving')::numeric,(data->>'elapsedTimeS')::numeric) > 60
     AND (data->>'avgHr')::numeric >= 144.8  -- HR gate pass at maxHr 181
   ORDER BY data->>'date' DESC`, [DAVID]);

// 6 · ALL rows in window ≥4mi: how many candidates total before/after gate change
await q('6 candidate counts before vs after COALESCE', `
  SELECT
    COUNT(*) FILTER (WHERE (data->>'movingTimeS')::numeric > 60) AS old_gate,
    COUNT(*) FILTER (WHERE COALESCE((data->>'durationSec')::numeric,(data->>'movingTimeS')::numeric,
        (data->>'movingSec')::numeric,(data->>'timeMoving')::numeric,(data->>'elapsedTimeS')::numeric) > 60) AS new_gate
    FROM runs
   WHERE user_uuid=$1::uuid AND data->>'mergedIntoId' IS NULL
     AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) >= '2025-12-12'
     AND (data->>'distanceMi')::numeric >= 4`, [DAVID]);

// 7 · stored weatherContext / slowdownPct (stored-vintage check)
await q('7 stored slowdown values on runs', `
  SELECT data->>'date' AS date,
         data->'weatherContext'->>'slowdownPct' AS wc_slowdown,
         data->'weather'->>'slowdownPct' AS w_slowdown,
         jsonb_exists(data,'weatherContext') AS has_wc,
         jsonb_exists(data,'weather') AS has_w
    FROM runs
   WHERE user_uuid=$1::uuid AND data->>'mergedIntoId' IS NULL
     AND (jsonb_exists(data,'weatherContext') OR jsonb_exists(data,'weather'))
   ORDER BY data->>'date' DESC LIMIT 12`, [DAVID]);

// 8 · decoupling steady-state series under NEW filter (≥6mi, 60d, excl plan-quality dates)
await q('8 decoupling series survivors (new filter)', `
  SELECT r.data->>'date' AS date, (r.data->>'distanceMi')::numeric AS mi,
         COALESCE(r.data->>'workoutType', r.data->>'type','') AS wt,
         jsonb_array_length(COALESCE(r.data->'splits','[]'::jsonb)) AS n_splits
    FROM runs r
   WHERE r.user_uuid=$1::uuid AND r.data->>'mergedIntoId' IS NULL
     AND (r.data->>'distanceMi')::numeric >= 6
     AND (r.data->>'date')::date >= CURRENT_DATE - INTERVAL '60 days'
     AND COALESCE(r.data->>'workoutType', r.data->>'type','') NOT IN ('race','intervals','threshold','tempo','fartlek')
     AND NOT EXISTS (
       SELECT 1 FROM plan_workouts pw JOIN training_plans tp ON tp.id=pw.plan_id
        WHERE tp.user_uuid=$1::uuid
          AND pw.date_iso = COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10))
          AND pw.type IN ('race','intervals','threshold','tempo','fartlek','race_week_tuneup'))
   ORDER BY r.data->>'date' ASC`, [DAVID]);

// 9 · tempo-drift detector inputs: watch_completion work phases on tempo days (21d)
await q('9 tempo sessions w/ watch work-phase pace (21d)', `
  SELECT pw.date_iso, pw.type,
    (SELECT AVG((phase->>'actualPaceSPerMi')::numeric)
       FROM coach_intents ci, jsonb_array_elements(
         CASE jsonb_typeof(ci.value::jsonb) WHEN 'object' THEN ci.value::jsonb->'phases' ELSE '[]'::jsonb END) AS phase
      WHERE COALESCE(ci.user_uuid, ci.user_id) = $1::uuid
        AND ci.reason='watch_completion' AND ci.ts::date = pw.date_iso::date
        AND phase->>'type'='work' AND (phase->>'actualPaceSPerMi')::numeric > 0) AS work_pace
    FROM plan_workouts pw JOIN training_plans tp ON tp.id=pw.plan_id
   WHERE tp.user_uuid=$1::uuid AND tp.archived_iso IS NULL
     AND pw.type IN ('tempo','threshold')
     AND pw.date_iso >= (CURRENT_DATE - INTERVAL '21 days')::text
     AND pw.date_iso <= CURRENT_DATE::text
   ORDER BY pw.date_iso`, [DAVID]);

// 10 · projection_snapshots recent + anchors
await q('10 projection snapshots (last 8)', `
  SELECT snapshot_date, distance_mi, vdot, projection_sec, vdot_anchor_date, vdot_anchor_distance_mi, source
    FROM projection_snapshots WHERE user_uuid=$1::uuid
   ORDER BY snapshot_date DESC, distance_mi LIMIT 8`, [DAVID]);

// 11 · race candidates in window as of Aug 1 + Jul 31 (cliff verification)
await q('11 races by date w/ results (cliff math)', `
  SELECT slug, meta->>'date' AS date, meta->>'priority' AS pri,
         actual_result->>'finishS' AS finish_s,
         (meta->>'distanceMi') AS dist_mi
    FROM races WHERE user_uuid=$1::uuid ORDER BY meta->>'date'`, [DAVID]);

// 12 · sick_episodes / niggles state (adapt interactions during taper)
await q('12 open sick/niggle rows', `
  SELECT 'sick' AS kind, COUNT(*) FROM sick_episodes WHERE user_uuid=$1::uuid
  UNION ALL SELECT 'niggle', COUNT(*) FROM niggles WHERE user_uuid=$1::uuid`, [DAVID]);

await pool.end();
