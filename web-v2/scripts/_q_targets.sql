-- David races (goal + all)
SELECT slug, meta->>'name' nm, meta->>'date' dt, meta->>'distance' dist,
  meta->>'goalTime' goal, meta->>'finishTime' fin,
  (actual_result IS NOT NULL) has_actual, saved_at::text
FROM races WHERE user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795'
ORDER BY meta->>'date'
--@
-- projection_snapshots VDOT trend (David)
SELECT snapshot_date::text d, distance, vdot, projection_sec, computed_at::text
FROM projection_snapshots WHERE user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795'
ORDER BY snapshot_date DESC LIMIT 12
--@
-- projection_snapshots schema
SELECT column_name FROM information_schema.columns WHERE table_name='projection_snapshots' ORDER BY ordinal_position
