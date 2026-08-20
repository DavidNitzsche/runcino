// Issue 1 recovery · backfill Jun 8 watch routePolyline from coach_intents,
// then clear weather_enriched_at to force re-enrichment. Approved + reviewed +
// reversible (CLAUDE.md gated-write doctrine). Parametrized by step so each
// write is executed + confirmed before the next.
//   node scripts/_recover_jun8_gps.mjs 1        -> Statement 1 (backfill polyline)
//   node scripts/_recover_jun8_gps.mjs 2        -> Statement 2 (null weather_enriched_at)
//   node scripts/_recover_jun8_gps.mjs verify   -> read current state
import fs from 'node:fs';
import pg from 'pg';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const URL_W = (env.match(/^DATABASE_URL=(.*)$/m)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
if (!URL_W) { console.error('REFUSING: no DATABASE_URL'); process.exit(1); }
const pool = new pg.Pool({ connectionString: URL_W });

const RUN_ID = '-243713397221312';
const WORKOUT = '0645f40c-951d-4ccc-b86e-9979cd26c795-2026-06-08';
const step = process.argv[2];

const cu = (await pool.query('SELECT current_user')).rows[0];
console.log(`# current_user=${cu.current_user} step=${step}`);

if (step === '1') {
  const r = await pool.query(
    `UPDATE runs r
     SET data = jsonb_set(r.data, '{routePolyline}', to_jsonb(ci.poly), true)
     FROM (
       SELECT value::jsonb->>'routePolyline' AS poly
       FROM coach_intents
       WHERE reason = 'watch_completion' AND field = $2 AND value::jsonb ? 'routePolyline'
       LIMIT 1
     ) ci
     WHERE r.id = $1
       AND r.data->>'source' = 'watch'
       AND ci.poly IS NOT NULL
       AND length(ci.poly) > 100`,
    [RUN_ID, WORKOUT],
  );
  console.log(`Statement 1 · rows updated = ${r.rowCount}`);
  const v = (await pool.query(
    `SELECT jsonb_typeof(data->'routePolyline') AS json_type,
            length(data->>'routePolyline')      AS poly_len,
            substring(data->>'routePolyline',1,40) AS head40
       FROM runs WHERE id = $1`, [RUN_ID],
  )).rows[0];
  console.log(`after S1 · routePolyline type=${v.json_type} len=${v.poly_len} head=${v.head40}`);
}
else if (step === '2') {
  const r = await pool.query(
    `UPDATE runs SET weather_enriched_at = NULL
      WHERE id = $1
        AND data->>'source' = 'watch'
        AND data->>'routePolyline' IS NOT NULL`,
    [RUN_ID],
  );
  console.log(`Statement 2 · rows updated = ${r.rowCount}`);
  const v = (await pool.query(
    `SELECT weather_enriched_at, (data ? 'weather') AS has_weather
       FROM runs WHERE id = $1`, [RUN_ID],
  )).rows[0];
  console.log(`after S2 · weather_enriched_at=${v.weather_enriched_at} has_weather=${v.has_weather}`);
}
else if (step === 'verify') {
  const v = (await pool.query(
    `SELECT length(data->>'routePolyline')  AS poly_len,
            weather_enriched_at,
            data->'weather'->>'temp_f'      AS weather_temp_f,
            data->>'tempF'                  AS tempf_top,
            data->'weather'->>'temp_f_peak' AS temp_peak,
            data->'weather'->>'humidity_pct' AS humidity
       FROM runs WHERE id = $1`, [RUN_ID],
  )).rows[0];
  console.log(JSON.stringify(v, null, 2));
}
else { console.error('unknown step (use 1 | 2 | verify)'); }
await pool.end();
