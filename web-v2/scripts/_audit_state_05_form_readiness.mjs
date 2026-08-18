// STATE AUDIT · Part 1.3: training form (TSB) replication + readiness + HR chimera + splits + pushes + shoes. RO.
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL_RO, ssl: { rejectUnauthorized: false } });
const UID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const TODAY = '2026-06-09';

// ── A) training form: exact port of computeTrainingForm ──
const lthr = (await pool.query(`SELECT lthr, hrmax, rhr, vo2max_apple, timezone FROM profile WHERE user_uuid=$1`, [UID])).rows[0];
console.log('=== profile physio ===', lthr);

const rows = (await pool.query(
  `WITH all_days AS (
     SELECT generate_series(($2::date - INTERVAL '60 days')::date, $2::date, '1 day'::interval)::date AS d
   ),
   daily_runs AS (
     SELECT (data->>'date')::date AS d,
            MAX((data->>'distanceMi')::numeric)::numeric AS mi,
            MAX((data->>'avgHr')::numeric)::numeric AS avg_hr,
            COUNT(*) AS n_rows,
            SUM((data->>'distanceMi')::numeric) AS sum_mi
       FROM runs
      WHERE user_uuid = $1::uuid AND NOT (data ? 'mergedIntoId') AND (data->>'date')::date >= $2::date - 60
      GROUP BY 1
   ),
   daily_plan AS (
     SELECT pw.date_iso::date AS d, pw.type
       FROM plan_workouts pw JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1::uuid AND tp.archived_iso IS NULL AND pw.date_iso::date >= $2::date - 60
   )
   SELECT a.d::text AS d, COALESCE(r.mi, 0)::text AS mi, r.avg_hr::text AS avg_hr, p.type AS inferred_type,
          COALESCE(r.n_rows,0) AS n_rows, COALESCE(r.sum_mi,0)::text AS sum_mi
     FROM all_days a
     LEFT JOIN daily_runs r ON r.d = a.d
     LEFT JOIN daily_plan p ON p.d = a.d
    ORDER BY a.d ASC`,
  [UID, TODAY])).rows;

// check for duplicated days via plan join (two plan_workouts same date would duplicate)
const dayCounts = {};
rows.forEach(r => { dayCounts[r.d] = (dayCounts[r.d] || 0) + 1; });
const dupDays = Object.entries(dayCounts).filter(([, n]) => n > 1);
console.log(`\n=== training form day-series: ${rows.length} rows for 61 days · duplicated days via plan-join: ${dupDays.length}`, dupDays.slice(0, 10));

const IF = { rest: 0, shakeout: 0.7, recovery: 0.8, easy: 0.85, long: 0.95, progression: 1.05, fartlek: 1.1, tempo: 1.15, threshold: 1.15, intervals: 1.25, race: 1.4 };
let ctl = 0, atl = 0; const tsbSeries = [];
const LTHR = lthr?.lthr ?? null;
for (const r of rows) {
  const mi = Number(r.mi) || 0;
  const avgHr = r.avg_hr ? Number(r.avg_hr) : null;
  const type = r.inferred_type ?? (mi >= 10 ? 'long' : avgHr && LTHR && avgHr >= LTHR * 0.88 ? 'tempo' : avgHr && LTHR && avgHr >= LTHR * 0.78 ? 'progression' : 'easy');
  const stress = mi * (IF[type] ?? 0.85);
  ctl = ctl * (1 - 1 / 42) + stress * (1 / 42);
  atl = atl * (1 - 1 / 7) + stress * (1 / 7);
  tsbSeries.push(ctl - atl);
}
const ctlS = Math.round(ctl * 10), atlS = Math.round(atl * 10), tsbS = ctlS - atlS;
console.log(`\nCOMPUTED training form (MAX-per-day, as app): CTL=${ctlS} ATL=${atlS} TSB=${tsbS} (label: ${tsbS > 25 ? 'DETRAINING' : tsbS > 10 ? 'RACE-READY' : tsbS > -10 ? 'PRODUCTIVE' : tsbS > -30 ? 'LOADED' : 'OVERREACH'})`);

// MAX vs SUM undercount check: days where SUM > MAX (doubles dropped by MAX)
const doubles = rows.filter(r => Number(r.n_rows) > 1 && Math.abs(Number(r.sum_mi) - Number(r.mi)) > 0.05);
console.log(`days where MAX-per-day drops a second real run (n_rows>1, sum>max): ${doubles.length}`);
doubles.forEach(r => console.log(`  ${r.d}: rows=${r.n_rows} max=${r.mi} sum=${r.sum_mi}`));

// ── B) readiness snapshots ──
console.log('\n=== readiness_snapshots last 7 ===');
console.table((await pool.query(
  `SELECT snapshot_date, score, band, computed_at::text FROM readiness_snapshots WHERE user_uuid=$1 ORDER BY snapshot_date DESC LIMIT 7`, [UID])).rows);
const pillars = (await pool.query(
  `SELECT snapshot_date, pillars FROM readiness_snapshots WHERE user_uuid=$1 ORDER BY snapshot_date DESC LIMIT 1`, [UID])).rows[0];
console.log('latest pillars:', JSON.stringify(pillars?.pillars)?.slice(0, 900));

// health samples freshness
console.log('\n=== health_samples freshness (latest per type, key types) ===');
console.table((await pool.query(
  `SELECT sample_type, MAX(sample_date)::text AS latest, COUNT(*) AS n,
          ROUND(AVG(value) FILTER (WHERE sample_date >= $2::date - 7), 1) AS avg_7d
     FROM health_samples WHERE user_uuid=$1 AND sample_type IN ('sleep_hours','hrv','resting_hr','hr_recovery','vo2_max')
    GROUP BY 1 ORDER BY 1`, [UID, TODAY])).rows);

// ── C) avgHr chimera: flagged runs ──
console.log('\n=== avgHr chimera / provenance flags on recent runs ===');
console.table((await pool.query(
  `SELECT COALESCE(data->>'date', LEFT(data->>'startLocal',10)) AS day, id, data->>'source' AS src,
          (data->>'distanceMi')::numeric AS mi, data->>'avgHr' AS avg_hr,
          data->>'avgHrChimera' AS chimera_flag, provenance->>'avgHr' AS prov_avg_hr,
          (data ? 'mergedIntoId') AS merged
     FROM runs WHERE user_uuid=$1
      AND (data ? 'avgHrChimera' OR provenance ? 'avgHr')
    ORDER BY 1 DESC LIMIT 15`, [UID])).rows);

// vdot gating exposure: quality runs in 180d whose avgHr >= 0.80*maxHr (the vdotFromRun gate)
const hrmax = lthr?.hrmax ?? null;
console.log(`\n=== runs that pass vdotFromRun HR gate (avgHr >= 0.8*${hrmax}) or quality-type, last 180d, dist>=4 ===`);
console.table((await pool.query(
  `SELECT COALESCE(data->>'date', LEFT(data->>'startLocal',10)) AS day, data->>'workoutType' AS wtype,
          ROUND((data->>'distanceMi')::numeric,2) AS mi, ROUND((data->>'durationSec')::numeric/60,1) AS mins,
          data->>'avgHr' AS avg_hr,
          ROUND((data->>'durationSec')::numeric / NULLIF((data->>'distanceMi')::numeric,0)) AS pace_s
     FROM runs WHERE user_uuid=$1 AND NOT (data ? 'mergedIntoId')
      AND (data->>'distanceMi')::numeric >= 4
      AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) >= '2025-12-11'
      AND ( LOWER(COALESCE(data->>'workoutType','')) IN ('threshold','tempo','cruise','intervals','vo2','vo2max','marathon_pace','mp','race','time_trial','tune_up')
            OR ((data->>'avgHr')::numeric >= 0.8 * $2) )
    ORDER BY 1 DESC LIMIT 20`, [UID, hrmax ?? 999])).rows);

// ── D) splits coverage on recent runs ──
console.log('\n=== splits coverage, last 15 canonical-ish runs ===');
console.table((await pool.query(
  `SELECT COALESCE(data->>'date', LEFT(data->>'startLocal',10)) AS day, data->>'source' AS src,
          ROUND((data->>'distanceMi')::numeric,2) AS mi,
          jsonb_array_length(COALESCE(data->'splits','[]'::jsonb)) AS n_splits,
          (data ? 'splits_unreliable') AS splits_unreliable,
          (data->>'elevGainFt') AS elev_ft, data->>'elevGainSource' AS elev_src,
          (data->'weather'->>'temp_f') AS temp_f,
          (data ? 'routePolyline') AS has_gps
     FROM runs WHERE user_uuid=$1 AND NOT (data ? 'mergedIntoId')
    ORDER BY COALESCE(data->>'date', LEFT(data->>'startLocal',10)) DESC LIMIT 15`, [UID])).rows);

// ── E) strava_pushes ──
console.log('\n=== strava_pushes (all) ===');
console.table((await pool.query(
  `SELECT id, run_id, status, strava_activity_id, attempt_count, error_message, pushed_at::text, completed_at::text
     FROM strava_pushes WHERE user_uuid=$1 ORDER BY pushed_at DESC`, [UID])).rows);

// ── F) shoes ──
console.log('\n=== shoes + computed mileage ===');
console.table((await pool.query(
  `SELECT s.id, s.brand, s.model, s.mileage AS stored_mileage, s.baseline_mi, s.mileage_cap, s.retired,
          ROUND(COALESCE(SUM((r.data->>'distanceMi')::numeric) FILTER (WHERE NOT (r.data ? 'mergedIntoId')), 0), 1) AS runs_mi_nonmerged,
          COUNT(r.id) FILTER (WHERE NOT (r.data ? 'mergedIntoId')) AS n_runs
     FROM shoes s LEFT JOIN runs r ON r.shoe_id = s.id AND r.user_uuid = s.user_uuid
    WHERE s.user_uuid=$1 GROUP BY s.id ORDER BY s.id`, [UID])).rows);

await pool.end();
