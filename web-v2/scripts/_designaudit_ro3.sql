-- David profile + users
SELECT p.experience_level, p.sex, p.age, p.lthr, p.lthr_method, p.rhr AS p_rhr, p.hrmax AS p_hrmax,
       p.hrmax_observed, p.goal_race_distance, p.goal_race_date, p.goal_race_time,
       p.history_avg_weekly_mi, p.history_longest_recent_mi, p.timezone,
       u.max_hr, u.resting_hr, u.vdot_last_reviewed, u.level, u.long_run_day, u.quality_days, u.rest_day
FROM profile p JOIN users u ON u.id = p.user_uuid
WHERE p.user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795';
--@
-- active plan
SELECT id, mode, race_id, goal_iso, authored_iso, archived_iso, last_adapted_at,
       authored_state->>'derived_from' AS derived_from
FROM training_plans
WHERE user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795' AND archived_iso IS NULL
ORDER BY authored_iso DESC;
--@
-- phases for active plan
SELECT ph.label, ph.start_week_idx, ph.end_week_idx, ph.citation
FROM plan_phases ph
JOIN training_plans tp ON tp.id = ph.plan_id
WHERE tp.user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795' AND tp.archived_iso IS NULL
ORDER BY ph.start_week_idx;
--@
-- weeks for active plan (idx, start, phase, flags)
SELECT w.week_idx, w.week_start_iso, w.phase_id, w.is_cutback, w.is_peak, w.is_race_week
FROM plan_weeks w
JOIN training_plans tp ON tp.id = w.plan_id
WHERE tp.user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795' AND tp.archived_iso IS NULL
ORDER BY w.week_idx;
--@
-- this week + next 2 weeks workouts (today=2026-06-08 Sun)
SELECT pw.date_iso, pw.dow, pw.type, pw.sub_label, pw.distance_mi, pw.pace_target_s_per_mi,
       pw.is_quality, pw.is_long, pw.workout_spec->>'hr_target_bpm' AS hr_t, pw.workout_spec->>'hr_cap_bpm' AS hr_cap
FROM plan_workouts pw
JOIN training_plans tp ON tp.id = pw.plan_id
WHERE tp.user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795' AND tp.archived_iso IS NULL
  AND pw.date_iso BETWEEN '2026-06-08' AND '2026-06-21'
ORDER BY pw.date_iso;
--@
-- recent 12 canonical runs
SELECT to_char((data->>'startDate')::timestamptz AT TIME ZONE 'America/Los_Angeles','YYYY-MM-DD Dy') AS run_date,
       round((data->>'distanceMi')::numeric,2) AS mi,
       data->>'type' AS sport_type,
       round((data->>'avgHr')::numeric,0) AS avg_hr,
       round((data->>'maxHr')::numeric,0) AS max_hr,
       round((data->>'movingTimeSec')::numeric/60,1) AS min,
       left(coalesce(data->>'name',''),22) AS name
FROM runs
WHERE user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795'
  AND (data->>'mergedIntoId') IS NULL
ORDER BY (data->>'startDate')::timestamptz DESC
LIMIT 12;
--@
-- readiness snapshots + pillars
SELECT snapshot_date, score, band, jsonb_pretty(pillars) AS pillars
FROM readiness_snapshots
WHERE user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795'
ORDER BY snapshot_date DESC LIMIT 2;
--@
-- all races full
SELECT meta->>'name' AS name, meta->>'date' AS date, meta->>'priority' AS prio,
       meta->>'distanceMi' AS dist, meta->>'goalDisplay' AS goal, meta->>'goalSafeDisplay' AS goal_safe,
       (actual_result IS NOT NULL) AS has_result, actual_result->>'finishTime' AS finish
FROM races
WHERE user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795'
ORDER BY meta->>'date';
--@
-- projection snapshots
SELECT snapshot_date, distance_mi, vdot, projection_sec, vdot_anchor_date
FROM projection_snapshots
WHERE user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795'
ORDER BY snapshot_date DESC LIMIT 4;
--@
-- current week planned vs actual volume (week Mon 06-02..Sun 06-08)
SELECT 'planned' AS k, round(sum(distance_mi),1) AS mi FROM plan_workouts pw
JOIN training_plans tp ON tp.id=pw.plan_id
WHERE tp.user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795' AND tp.archived_iso IS NULL
  AND pw.date_iso BETWEEN '2026-06-02' AND '2026-06-08'
UNION ALL
SELECT 'actual', round(sum((data->>'distanceMi')::numeric),1) FROM runs
WHERE user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795' AND (data->>'mergedIntoId') IS NULL
  AND to_char((data->>'startDate')::timestamptz AT TIME ZONE 'America/Los_Angeles','YYYY-MM-DD') BETWEEN '2026-06-02' AND '2026-06-08';
