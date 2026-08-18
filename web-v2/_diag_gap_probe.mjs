// READ-ONLY probe: David's last 5 weeks of runs, plan state, upcoming race
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const uid = '0645f40c-951d-4ccc-b86e-9979cd26c795';

const runs = await pool.query(
  `SELECT COALESCE(data->>'date', LEFT(data->>'startLocal',10)) AS d,
          ROUND((data->>'distanceMi')::numeric,1) AS mi,
          data->>'workoutType' AS wt,
          data->>'name' AS name,
          data->>'source' AS src
     FROM runs
    WHERE user_uuid = $1::uuid AND NOT (data ? 'mergedIntoId')
      AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) >= '2026-06-01'
    ORDER BY 1 DESC`, [uid]);
console.log('=== runs since Jun 1 ===');
for (const r of runs.rows) console.log(`${r.d}  ${String(r.mi).padStart(5)}mi  ${r.wt ?? '-'}  ${r.name ?? ''}  [${r.src ?? '?'}]`);

const races = await pool.query(
  `SELECT slug, data->>'name' AS name, data->>'date' AS date, data->>'distance' AS dist,
          data->>'goalTime' AS goal, (actual_result IS NOT NULL) AS done
     FROM races WHERE user_uuid = $1::uuid AND (data->>'date') >= '2026-06-15' ORDER BY data->>'date'`, [uid]
).catch(e => ({ rows: [], err: e.message }));
console.log('\n=== upcoming races ===', races.err ?? '');
for (const r of races.rows) console.log(r);

// what plan tables exist
const tabs = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%plan%' ORDER BY 1`);
console.log('\n=== plan tables ===', tabs.rows.map(t => t.table_name).join(', '));

const pw = await pool.query(
  `SELECT date, workout_type, ROUND(distance_mi::numeric,1) AS mi, status
     FROM plan_workouts WHERE user_uuid = $1::uuid AND date BETWEEN '2026-06-22' AND '2026-07-20'
    ORDER BY date`, [uid]
).catch(e => ({ rows: [], err: e.message }));
console.log('\n=== plan_workouts Jun22–Jul20 ===', pw.err ?? '');
for (const r of pw.rows) console.log(`${r.date instanceof Date ? r.date.toISOString().slice(0,10) : r.date}  ${String(r.mi ?? '-').padStart(5)}mi  ${r.workout_type ?? '-'}  ${r.status ?? ''}`);

await pool.end();
