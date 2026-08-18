-- runs schema (key cols)
SELECT column_name, data_type FROM information_schema.columns WHERE table_name='runs'
  AND column_name IN ('id','user_uuid','date','distance_mi','name','source','data','merged_into_id','shoe_id','splits_unreliable','workout_type','start_time')
ORDER BY ordinal_position
--@
-- David run counts by source + merged
SELECT source, count(*) n, count(*) FILTER (WHERE merged_into_id IS NOT NULL) merged,
  min(date)::text earliest, max(date)::text latest
FROM runs WHERE user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795'
GROUP BY source ORDER BY n DESC
--@
-- David recent 15 canonical runs
SELECT date::text d, round(distance_mi,2) mi, name, source,
  (merged_into_id IS NOT NULL) merged, shoe_id,
  data->>'inferredType' inferred, data->>'avgHr' avg_hr,
  (data->>'splits_unreliable') splits_unrel
FROM runs WHERE user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795'
  AND merged_into_id IS NULL
ORDER BY date DESC LIMIT 15
