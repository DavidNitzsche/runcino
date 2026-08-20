// READ-ONLY retrospective probe 1: plan structure, weeks, workouts, runs overview
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const uid = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const planId = 'pln_ca91f252bba50c74';

// plan row
const pcols = await pool.query(`SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name='training_plans' ORDER BY ordinal_position`);
console.log('training_plans cols:', pcols.rows.map(r=>r.column_name+'('+r.data_type+')').join(' '));
const plan = await pool.query(`SELECT * FROM training_plans WHERE id=$1`, [planId]);
console.log('=== plan ===');
const p = plan.rows[0];
for (const [k,v] of Object.entries(p)) {
  const s = JSON.stringify(v);
  console.log(k+':', s && s.length > 300 ? s.slice(0,300)+'…[len '+s.length+']' : s);
}

// columns of plan_workouts / plan_weeks
const cols = await pool.query(`SELECT table_name, column_name, data_type FROM information_schema.columns
  WHERE table_name IN ('plan_workouts','plan_weeks','workout_completions','skipped_workouts','post_run_rpe','plan_mutations','races')
  ORDER BY table_name, ordinal_position`);
console.log('\n=== columns ===');
let last = '';
for (const c of cols.rows) {
  if (c.table_name !== last) { console.log('\n' + c.table_name + ':'); last = c.table_name; }
  process.stdout.write(c.column_name + '(' + c.data_type + ') ');
}
console.log();

// plan weeks
const weeks = await pool.query(`SELECT * FROM plan_weeks WHERE plan_id=$1 ORDER BY 1`, [planId]);
console.log('\n=== plan_weeks (' + weeks.rows.length + ') ===');
for (const w of weeks.rows) console.log(JSON.stringify(w));

await pool.end();
