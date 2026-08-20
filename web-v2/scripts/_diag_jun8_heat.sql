-- jun8 run weather + zones + hr + splits for heat/drift diagnosis
SELECT
  r.id,
  r.data->>'source'                       AS source,
  (r.data->>'distanceMi')::numeric        AS dist_mi,
  r.data->>'avgPaceMinPerMi'              AS avg_pace,
  r.data->>'avgHr'                        AS avg_hr,
  r.data->>'maxHr'                        AS max_hr,
  r.data->>'tempF'                        AS temp_f_top,
  r.data->'weather'->>'temp_f'            AS weather_temp_f,
  r.data->'weather'->>'temp_f_peak'       AS weather_temp_peak,
  r.data->'weather'->>'humidity_pct'      AS humidity_pct,
  r.data->'weather'->>'conditions'        AS conditions,
  r.data->'weather'->>'version'           AS weather_version,
  r.data->'hrZonePcts'                    AS hr_zone_pcts,
  jsonb_array_length(COALESCE(r.data->'splits','[]'::jsonb)) AS n_splits
FROM runs r
WHERE r.data->>'date' = '2026-06-08' AND r.data->>'source' = 'watch';
--@
-- jun8 per-split hr + pace (for decoupling h1 vs h2 by hand)
SELECT
  (s->>'mile')          AS mile,
  (s->>'pace')          AS pace,
  COALESCE(s->>'hr', s->>'avgHr') AS hr
FROM runs r,
     jsonb_array_elements(r.data->'splits') s
WHERE r.data->>'date' = '2026-06-08' AND r.data->>'source' = 'watch'
ORDER BY (s->>'mile')::int;
