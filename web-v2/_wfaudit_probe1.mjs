import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const uid = '0645f40c-951d-4ccc-b86e-9979cd26c795';

const prof = (await pool.query(`SELECT lthr, hrmax, rhr, vdot FROM profile WHERE user_uuid=$1 LIMIT 1`, [uid]).catch(e=>({rows:[{err:String(e)}]}))).rows[0];
console.log('profile:', JSON.stringify(prof));

const race = (await pool.query(`SELECT meta->>'name' name, meta->>'date' date, meta->>'goalDisplay' goal, meta->>'distanceMi' dmi, meta->>'priority' prio FROM races WHERE user_uuid=$1 AND (meta->>'date')::date >= CURRENT_DATE ORDER BY meta->>'date' LIMIT 3`, [uid])).rows;
console.log('upcoming races:', JSON.stringify(race));

const plan = (await pool.query(`SELECT id::text, status FROM training_plans WHERE user_uuid=$1 AND status='active' LIMIT 1`, [uid])).rows[0];
console.log('plan:', JSON.stringify(plan));

if (plan) {
  const wk = (await pool.query(`SELECT date_iso, type, distance_mi, sub_label, pace_target_s_per_mi, workout_spec FROM plan_workouts WHERE plan_id=$1 AND date_iso::date BETWEEN CURRENT_DATE - 2 AND CURRENT_DATE + 7 ORDER BY date_iso`, [plan.id])).rows;
  for (const w of wk) console.log(w.date_iso, w.type, w.distance_mi, '|', w.sub_label, '| pace_target:', w.pace_target_s_per_mi, '| spec:', JSON.stringify(w.workout_spec));
}
await pool.end();
