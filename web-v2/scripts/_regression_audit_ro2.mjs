// REGRESSION AUDIT follow-up · find the string-typed duration rows that
// break the new vdot-inputs COALESCE cast, plus sick episodes + window math.
import { Pool } from 'pg';
const url = process.env.DATABASE_URL_RO;
if (!url || !/faff_readonly/.test(url)) { console.error('REFUSED'); process.exit(1); }
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
const q = async (label, sql, params = []) => {
  try {
    const r = await pool.query(sql, params);
    console.log(`\n=== ${label} (${r.rows.length}) ===`);
    for (const row of r.rows.slice(0, 50)) console.log(JSON.stringify(row));
  } catch (e) { console.log(`\n=== ${label} ERROR: ${e.message} ===`); }
};
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

// A · which duration-ish fields hold NON-NUMERIC strings, on which rows
await q('A non-numeric duration fields (all rows, any user)', `
  SELECT user_uuid, id, data->>'date' AS date, data->>'source' AS source,
         data->>'mergedIntoId' AS merged_into,
         (data->>'distanceMi') AS mi,
         CASE WHEN data->>'durationSec'  !~ '^[0-9.]+$' THEN data->>'durationSec'  END AS bad_durationSec,
         CASE WHEN data->>'movingTimeS'  !~ '^[0-9.]+$' THEN data->>'movingTimeS'  END AS bad_movingTimeS,
         CASE WHEN data->>'movingSec'    !~ '^[0-9.]+$' THEN data->>'movingSec'    END AS bad_movingSec,
         CASE WHEN data->>'timeMoving'   !~ '^[0-9.]+$' THEN data->>'timeMoving'   END AS bad_timeMoving,
         CASE WHEN data->>'elapsedTimeS' !~ '^[0-9.]+$' THEN data->>'elapsedTimeS' END AS bad_elapsedTimeS
    FROM runs
   WHERE (data ? 'durationSec'  AND data->>'durationSec'  !~ '^[0-9.]+$')
      OR (data ? 'movingTimeS'  AND data->>'movingTimeS'  !~ '^[0-9.]+$')
      OR (data ? 'movingSec'    AND data->>'movingSec'    !~ '^[0-9.]+$')
      OR (data ? 'timeMoving'   AND data->>'timeMoving'   !~ '^[0-9.]+$')
      OR (data ? 'elapsedTimeS' AND data->>'elapsedTimeS' !~ '^[0-9.]+$')
   ORDER BY data->>'date' DESC`);

// B · sick episodes detail (taper adapt interaction)
await q('B sick episodes', `
  SELECT id, started_iso, cleared_iso, severity, note
    FROM sick_episodes WHERE user_uuid=$1::uuid ORDER BY started_iso DESC`, [DAVID]);

// C · 60d run-candidate window membership for bad rows + newly-qualifying rows (safe casts)
await q('C newly-qualifying candidates 60d window (safe)', `
  SELECT id, data->>'date' AS date, data->>'source' AS source,
         (data->>'distanceMi') AS mi, (data->>'avgHr') AS avg_hr,
         data->>'movingTimeS' AS movingTimeS_raw,
         data->>'durationSec' AS durationSec_raw,
         data->>'timeMoving' AS timeMoving_raw,
         data->'provenance'->>'avgHr' AS prov_avghr
    FROM runs
   WHERE user_uuid=$1::uuid AND data->>'mergedIntoId' IS NULL
     AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) >= (CURRENT_DATE - INTERVAL '60 days')::text
     AND (data->>'distanceMi') ~ '^[0-9.]+$'
     AND (data->>'distanceMi')::numeric >= 4
     AND (data->>'movingTimeS') IS NULL
   ORDER BY data->>'date' DESC`, [DAVID]);

// D · race-day±1 exclusion sanity for Aug 16 (the AFC completion itself)
await q('D rows that bad-cast could hit in 60d window AS OF Aug 1 (dates Jun 2+)', `
  SELECT id, data->>'date' AS date, data->>'source' AS source,
         data->>'timeMoving' AS timeMoving_raw
    FROM runs
   WHERE user_uuid=$1::uuid
     AND data ? 'timeMoving'
     AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) >= '2026-06-02'`, [DAVID]);

// E · merged-row protection: do any non-merged rows carry chimera-labeled avgHr in 60d?
await q('E provenance-labeled avgHr rows (non-merged, 60d)', `
  SELECT id, data->>'date' AS date, data->>'source' AS source,
         data->>'avgHr' AS avg_hr, data->'provenance'->>'avgHr' AS prov
    FROM runs
   WHERE user_uuid=$1::uuid AND data->>'mergedIntoId' IS NULL
     AND data->'provenance' ? 'avgHr'
     AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) >= (CURRENT_DATE - INTERVAL '60 days')::text
   ORDER BY data->>'date' DESC LIMIT 15`, [DAVID]);

await pool.end();
