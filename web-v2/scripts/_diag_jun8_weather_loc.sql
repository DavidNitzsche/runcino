-- jun8 row: location + weather_enriched_at + zone source fields
SELECT
  r.id,
  r.weather_enriched_at,
  r.data ? 'startLatLng'                 AS has_startlatlng,
  r.data->>'startLatLng'                 AS start_lat_lng,
  r.data ? 'routePolyline'               AS has_route_polyline,
  r.data ? 'summaryPolyline'             AS has_summary_polyline,
  r.data ? 'hrZonePcts'                  AS has_hrzonepcts,
  r.data ? 'hrSamples'                   AS has_hrsamples,
  r.data->>'avgHr'                       AS avg_hr,
  r.data->>'maxHr'                       AS max_hr
FROM runs r
WHERE r.data->>'date' = '2026-06-08' AND r.data->>'source' = 'watch';
--@
-- profile home location + lthr for this user (heat needs a lat/lng somewhere)
SELECT
  substring(user_uuid::text,1,8) AS usr,
  data ? 'homeLat'              AS has_home_lat,
  data->>'homeLat'             AS home_lat,
  data->>'homeLng'             AS home_lng,
  data->>'lthr'                AS lthr,
  data->>'maxHr'               AS max_hr,
  data->>'timezone'            AS tz
FROM profile
WHERE user_uuid = (SELECT user_uuid FROM runs WHERE data->>'date'='2026-06-08' AND data->>'source'='watch' LIMIT 1);
