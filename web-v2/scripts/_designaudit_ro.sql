-- profile + users
SELECT p.experience_level, p.sex, p.age, p.lthr, p.rhr, p.hrmax, p.goal_race_distance_mi,
       u.timezone, u.max_hr, u.resting_hr, u.vdot_last_reviewed, u.fuel_brand, u.fuel_target_g_per_hr
FROM profile p JOIN users u ON u.user_uuid=p.user_uuid
WHERE p.user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795';
--@
-- plan_workouts columns
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name='plan_workouts' ORDER BY ordinal_position;
--@
-- races columns
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name='races' ORDER BY ordinal_position;
--@
-- readiness snapshot columns
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name='readiness_snapshots' ORDER BY ordinal_position;
--@
-- today + this week plan (2026-06-08 is a Sunday; week Mon 06-02..Sun 06-08)
SELECT date_iso, type, sub_label, distance_mi, pace_target_s_per_mi,
       workout_spec->>'hr_target_bpm' AS hr_target, workout_spec->>'hr_cap_bpm' AS hr_cap
FROM plan_workouts
WHERE user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795'
  AND date_iso BETWEEN '2026-06-02' AND '2026-06-15'
ORDER BY date_iso;
--@
-- recent 12 canonical runs
SELECT to_char((data->>'startDate')::timestamptz AT TIME ZONE 'America/Los_Angeles','YYYY-MM-DD') AS run_date,
       round((data->>'distanceMi')::numeric,2) AS mi,
       data->>'type' AS sport_type,
       round((data->>'avgHr')::numeric,0) AS avg_hr,
       round((data->>'maxHr')::numeric,0) AS max_hr,
       name
FROM runs
WHERE user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795'
  AND (data->>'mergedIntoId') IS NULL
ORDER BY (data->>'startDate')::timestamptz DESC
LIMIT 12;
--@
-- latest readiness snapshots
SELECT snapshot_date, score, band, label
FROM readiness_snapshots
WHERE user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795'
ORDER BY snapshot_date DESC LIMIT 5;
--@
-- races for David
SELECT slug, meta->>'name' AS name, meta->>'date' AS date, meta->>'priority' AS prio,
       meta->>'goalDisplay' AS goal, meta->>'goalSafeDisplay' AS goal_safe,
       (actual_result IS NOT NULL) AS has_result
FROM races
WHERE user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795'
ORDER BY meta->>'date';
--@
-- latest projection snapshots
SELECT snapshot_date, distance_mi, vdot, projection_sec, vdot_anchor_date
FROM projection_snapshots
WHERE user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795'
ORDER BY snapshot_date DESC LIMIT 4;
