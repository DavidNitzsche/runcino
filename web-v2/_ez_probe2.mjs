import { Pool } from 'pg';
const U = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: process.env.DATABASE_URL_RO || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const fmt = s => s == null ? '—' : `${Math.floor(s/60)}:${String(Math.round(s%60)).padStart(2,'0')}`;

const shape = await pool.query(
  `SELECT plan_id, date_iso, type, workout_spec FROM plan_workouts
   WHERE user_uuid=$1 AND type='easy' AND workout_spec IS NOT NULL
   ORDER BY date_iso DESC LIMIT 1`, [U]);
console.log('== workout_spec shape ==\n', JSON.stringify(shape.rows[0]?.workout_spec, null, 1).slice(0, 900));

const plans = await pool.query(
  `SELECT plan_id, count(*) n, min(date_iso) a, max(date_iso) b FROM plan_workouts
   WHERE user_uuid=$1 GROUP BY plan_id ORDER BY max(date_iso) DESC LIMIT 6`, [U]);
console.log('\n== plans ==');
plans.rows.forEach(r => console.log(` ${r.plan_id}  n=${r.n}  ${r.a}..${r.b}`));
await pool.end();
