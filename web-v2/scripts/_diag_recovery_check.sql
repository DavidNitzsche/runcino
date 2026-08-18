-- recoverable polylines in coach_intents for jun7 + jun8
SELECT
  field AS workout_id,
  value::jsonb->>'startedAt'                AS started_at,
  (value::jsonb ? 'routePolyline')          AS has_camel,
  length(value::jsonb->>'routePolyline')    AS camel_len,
  (value::jsonb ? 'route_polyline')         AS has_snake
FROM coach_intents
WHERE reason = 'watch_completion'
  AND (value::jsonb->>'startedAt' LIKE '2026-06-07%'
       OR value::jsonb->>'startedAt' LIKE '2026-06-08%')
ORDER BY value::jsonb->>'startedAt';
