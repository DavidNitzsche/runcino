import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const uid = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const r = await pool.query(
  `SELECT id, data->>'source' src, data->>'workoutType' wt,
          COALESCE(data->>'date', LEFT(data->>'startLocal',10)) d,
          ROUND((data->>'distanceMi')::numeric,2) mi,
          (data ? 'splits') has_splits,
          jsonb_array_length(COALESCE(data->'splits','[]'::jsonb)) nsplits,
          data->>'splitsUnreliable' unreliable
     FROM runs
    WHERE user_uuid=$1 AND NOT (data ? 'mergedIntoId')
      AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) >= '2026-07-08'
    ORDER BY d DESC, mi DESC`, [uid]);
console.log('=== recent runs ==='); r.rows.forEach(x=>console.log(JSON.stringify(x)));
const top = r.rows[0];
if (top) {
  const s = await pool.query(`SELECT data->'splits' splits, data->'workoutSpec' spec, data->'phaseBreakdown' pb FROM runs WHERE id=$1`, [top.id]);
  console.log('\n=== splits for', top.id, '===');
  const splits = s.rows[0].splits || [];
  splits.forEach((sp,i)=>console.log(`#${i+1}`, JSON.stringify(sp)));
  console.log('\n=== phaseBreakdown ==='); console.log(JSON.stringify(s.rows[0].pb));
}
await pool.end();
