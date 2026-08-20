-- jun8 all rows source distance polyline
SELECT
  r.id,
  substring(r.user_uuid::text,1,8) AS usr,
  r.data->>'source'        AS source,
  r.data->>'date'          AS date,
  r.data->>'startLocal'    AS start_local,
  (r.data->>'distanceMi')::numeric AS dist_mi,
  (r.data->>'durationSec')::numeric AS dur_sec,
  (r.data ? 'routePolyline')               AS has_polyline_key,
  length(r.data->>'routePolyline')         AS polyline_len,
  r.data->>'mergedIntoId'  AS merged_into,
  r.data->>'avgHr'         AS avg_hr,
  r.data->>'maxHr'         AS max_hr,
  r.data->>'ingestedAt'    AS ingested_at
FROM runs r
WHERE r.data->>'date' IN ('2026-06-07','2026-06-08')
ORDER BY r.data->>'date', r.data->>'startLocal', r.id;
--@
-- jun8 coach_intents watch_completion payload presence of route_polyline
SELECT
  substring(COALESCE(user_uuid::text,user_id::text),1,8) AS usr,
  field AS workout_id,
  (value::jsonb ? 'route_polyline')                 AS has_route_polyline_key,
  length(value::jsonb->>'route_polyline')           AS route_polyline_len,
  (value::jsonb->>'totalDistanceMi')                AS total_dist,
  (value::jsonb->>'startedAt')                      AS started_at,
  jsonb_array_length(COALESCE(value::jsonb->'phases','[]'::jsonb)) AS n_phases
FROM coach_intents
WHERE reason = 'watch_completion'
  AND (value::jsonb->>'startedAt' LIKE '2026-06-08%'
       OR value::jsonb->>'startedAt' LIKE '2026-06-07%')
ORDER BY value::jsonb->>'startedAt';
--@
-- does any phase carry paceSamples with lat lng (gps in samples)? inspect first watch_completion jun8 keys
SELECT
  field AS workout_id,
  (SELECT string_agg(k, ', ' ORDER BY k) FROM jsonb_object_keys(value::jsonb) k) AS top_keys
FROM coach_intents
WHERE reason = 'watch_completion'
  AND value::jsonb->>'startedAt' LIKE '2026-06-08%'
LIMIT 3;
