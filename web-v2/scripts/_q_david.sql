-- David profile key fields
SELECT runner_id, full_name, experience_level, sex, age, rhr, hrmax, hrmax_observed,
  lthr, lthr_method, goal_race_distance, goal_race_time, goal_race_date,
  health_connected_at, strava_connected_at, history_avg_weekly_mi
FROM profile
--@
-- David users row (all cols)
SELECT * FROM users WHERE uuid IN (SELECT user_uuid FROM health_samples LIMIT 1)
--@
-- David recent 14d core metrics pivot
SELECT sample_date::text d,
  max(value) FILTER (WHERE sample_type='hrv') hrv,
  max(value) FILTER (WHERE sample_type='resting_hr') rhr,
  round(max(value) FILTER (WHERE sample_type='sleep_hours'),2) sleep_h,
  max(value) FILTER (WHERE sample_type='respiratory_rate') resp,
  max(value) FILTER (WHERE sample_type='wrist_temp') wrist_temp,
  max(value) FILTER (WHERE sample_type='spo2') spo2,
  max(value) FILTER (WHERE sample_type='hr_recovery') hrr
FROM health_samples
WHERE user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795' AND sample_date >= CURRENT_DATE-14
GROUP BY sample_date ORDER BY sample_date DESC
--@
-- body composition + vo2 history
SELECT sample_date::text d, sample_type, round(value,2) value FROM health_samples
WHERE user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795'
  AND sample_type IN ('body_mass','body_fat_pct','lean_mass','vo2_max')
ORDER BY sample_type, sample_date DESC
