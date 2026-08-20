-- users schema
SELECT column_name, data_type FROM information_schema.columns WHERE table_name='users' ORDER BY ordinal_position
--@
-- David users row (find by run author)
SELECT u.* FROM users u
WHERE EXISTS (SELECT 1 FROM runs r WHERE r.user_uuid=u.id) OR u.id='0645f40c-951d-4ccc-b86e-9979cd26c795'
LIMIT 3
--@
-- David max_hr from health_samples (30d max) vs profile
SELECT
  (SELECT max(value) FROM health_samples WHERE user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795' AND sample_type='max_hr' AND sample_date>=CURRENT_DATE-30) hk_max30,
  (SELECT max(value) FROM health_samples WHERE user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795' AND sample_type='max_hr') hk_max_all,
  (SELECT rhr FROM profile) profile_rhr,
  (SELECT hrmax FROM profile) profile_hrmax
