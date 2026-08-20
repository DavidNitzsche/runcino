-- jun8 raw payload routePolyline (camel) length + first chars
SELECT
  field AS workout_id,
  length(value::jsonb->>'routePolyline')          AS camel_routePolyline_len,
  substring(value::jsonb->>'routePolyline',1,40)  AS camel_first40,
  (value::jsonb ? 'route_polyline')               AS has_snake_key,
  (value::jsonb ? 'routePolyline')                AS has_camel_key
FROM coach_intents
WHERE reason = 'watch_completion'
  AND value::jsonb->>'startedAt' LIKE '2026-06-08%';
--@
-- canonical jun8 row: is routePolyline json-null or string?
SELECT
  r.id,
  jsonb_typeof(r.data->'routePolyline')  AS polyline_json_type,
  r.data->>'routePolyline'               AS polyline_value
FROM runs r
WHERE r.data->>'date' = '2026-06-08' AND r.data->>'source' = 'watch';
