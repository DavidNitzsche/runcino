// STATE FIX SMOKE · run the NEW detector SQL against prod (RO) to falsify the fixes.
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL_RO, ssl: { rejectUnauthorized: false } });
const UID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const TODAY = '2026-06-09';
const FROM21 = '2026-05-19';

// 1. NEW tempo-drift query (work-phase pace from watch_completion per plan tempo day)
const drift = (await pool.query(
  `SELECT AVG(t.work_pace) AS avg_pace_s, COUNT(*) AS count
     FROM (
       SELECT pw.date_iso,
              ( SELECT AVG((phase->>'actualPaceSPerMi')::numeric)
                  FROM coach_intents ci,
                       jsonb_array_elements(
                         CASE jsonb_typeof(ci.value::jsonb)
                           WHEN 'object' THEN ci.value::jsonb->'phases'
                           ELSE '[]'::jsonb END) AS phase
                 WHERE COALESCE(ci.user_uuid, ci.user_id) = $1::uuid
                   AND ci.reason = 'watch_completion'
                   AND ci.ts::date = pw.date_iso::date
                   AND phase->>'type' = 'work'
                   AND (phase->>'actualPaceSPerMi')::numeric > 0 ) AS work_pace
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1::uuid AND tp.archived_iso IS NULL
          AND pw.type IN ('tempo','threshold')
          AND pw.date_iso >= $3 AND pw.date_iso <= $2
     ) t WHERE t.work_pace IS NOT NULL`,
  [UID, TODAY, FROM21])).rows[0];
console.log('NEW tempo-drift inputs:', drift, '· T(47.9)=430 · signal fires if avg-430 >= 10 AND count>=3');

// 2. NEW decoupling exclusion: which runs ≥6mi survive vs which get excluded by the plan-join
const dec = (await pool.query(
  `SELECT COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10)) AS day,
          ROUND((r.data->>'distanceMi')::numeric,1) AS mi,
          COALESCE(r.data->>'workoutType', r.data->>'type', '') AS wtype,
          EXISTS (
            SELECT 1 FROM plan_workouts pw JOIN training_plans tp ON tp.id = pw.plan_id
             WHERE tp.user_uuid = $1::uuid
               AND pw.date_iso = COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10))
               AND pw.type IN ('race','intervals','threshold','tempo','fartlek','race_week_tuneup')
          ) AS excluded_by_plan_join
     FROM runs r
    WHERE r.user_uuid = $1::uuid AND NOT (r.data ? 'mergedIntoId')
      AND (r.data->>'distanceMi')::numeric >= 6
      AND (r.data->>'date')::date >= $2::date - interval '60 days'
    ORDER BY 1`,
  [UID, TODAY])).rows;
console.log('\nDecoupling candidates (≥6mi, 60d) · excluded_by_plan_join = the NEW filter doing work:');
console.table(dec);
const kept = dec.filter(d => !d.excluded_by_plan_join).length;
console.log(`kept as steady-state: ${kept} of ${dec.length} (old filter kept ALL ${dec.length})`);

// 3. NEW vdot-inputs duration filter: how many run rows newly pass
const vd = (await pool.query(
  `SELECT COUNT(*) FILTER (WHERE (sa.data->>'movingTimeS')::numeric > 60) AS old_pass,
          COUNT(*) FILTER (WHERE COALESCE(
            (sa.data->>'durationSec')::numeric, (sa.data->>'movingTimeS')::numeric,
            (sa.data->>'movingSec')::numeric, (sa.data->>'elapsedTimeS')::numeric) > 60) AS new_pass
     FROM runs sa
    WHERE sa.user_uuid = $1 AND NOT (sa.data ? 'mergedIntoId')
      AND COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10)) >= '2026-04-10'
      AND (sa.data->>'distanceMi')::numeric >= 4
      AND NOT EXISTS (
        SELECT 1 FROM races rr WHERE rr.user_uuid = $1
          AND ABS((rr.meta->>'date')::date - COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10))::date) <= 1)`,
  [UID])).rows[0];
console.log(`\nvdot-inputs 60d-window run candidates · OLD movingTimeS filter: ${vd.old_pass} · NEW COALESCE filter: ${vd.new_pass}`);
await pool.end();
