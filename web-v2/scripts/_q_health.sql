-- 1. users + profile schema
SELECT 'users' tbl, column_name, data_type FROM information_schema.columns WHERE table_name='users'
UNION ALL
SELECT 'profile', column_name, data_type FROM information_schema.columns WHERE table_name='profile'
ORDER BY tbl, column_name
--@
-- 2. health_samples counts by sample_type (whole DB)
SELECT sample_type, count(*) n, min(sample_date) earliest, max(sample_date) latest,
  count(DISTINCT user_uuid) users, count(DISTINCT source) sources
FROM health_samples GROUP BY sample_type ORDER BY n DESC
--@
-- 3. health_samples sources (whole DB)
SELECT source, count(*) n FROM health_samples GROUP BY source ORDER BY n DESC
--@
-- 4. users rows (identify David)
SELECT * FROM users ORDER BY 1 LIMIT 10
--@
-- 5. David health_samples by type (user_uuid)
SELECT sample_type, count(*) n, min(sample_date) earliest, max(sample_date) latest,
  round(avg(value),1) avg_val
FROM health_samples WHERE user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795'
GROUP BY sample_type ORDER BY n DESC
--@
-- 6. David most recent 21 days each type (pivot-ish)
SELECT sample_date, sample_type, round(value,1) value, source FROM health_samples
WHERE user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795'
  AND sample_date >= (CURRENT_DATE - 21)
ORDER BY sample_date DESC, sample_type
