// Read-only diagnostic · Watch Gap #2 · does the stored workout_spec for
// David's structured long runs carry finish_mi/finish_pace_s_per_mi/finish_label?
// Uses DATABASE_URL_RO (faff_readonly) per RO-by-default doctrine.
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const RO = env.match(/^DATABASE_URL_RO=(.+)$/m)[1].replace(/^["']|["']$/g, '').trim();
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: RO, ssl: { rejectUnauthorized: false }, max: 2 });

const who = (await pool.query('SELECT current_user')).rows[0];
console.log(`current_user = ${who.current_user}`);

const plan = (await pool.query(
  `SELECT id, authored_iso, archived_iso
     FROM training_plans
    WHERE user_uuid=$1 AND archived_iso IS NULL
    ORDER BY authored_iso DESC LIMIT 1`, [DAVID])).rows[0];
console.log(`\nactive plan id = ${plan?.id}  authored=${plan?.authored_iso}  archived=${plan?.archived_iso ?? 'null'}`);

// All long-type workouts in the plan (the structured-finish window is Jun 28–Aug 2)
const longs = (await pool.query(
  `SELECT date_iso, dow, type, distance_mi, sub_label,
          pace_target_s_per_mi,
          workout_spec
     FROM plan_workouts
    WHERE plan_id=$1 AND type='long'
    ORDER BY date_iso ASC`, [plan.id])).rows;

console.log(`\n${longs.length} long-type workouts in plan:\n`);
for (const w of longs) {
  const s = w.workout_spec || {};
  const hasFinish = s.finish_mi != null && s.finish_pace_s_per_mi != null;
  console.log(`── ${w.date_iso} (${w.dow}) · ${w.distance_mi} mi · sub_label="${w.sub_label}"`);
  console.log(`   pace_target_s_per_mi=${w.pace_target_s_per_mi}`);
  console.log(`   spec.kind=${s.kind}  lo=${s.pace_target_s_per_mi_lo} hi=${s.pace_target_s_per_mi_hi} hr_cap=${s.hr_cap_bpm}`);
  console.log(`   spec.finish_mi=${s.finish_mi ?? 'ABSENT'}  finish_pace_s_per_mi=${s.finish_pace_s_per_mi ?? 'ABSENT'}  finish_label=${s.finish_label ?? 'ABSENT'}`);
  console.log(`   → finish branch fires in expandLong? ${hasFinish ? 'YES (2 phases)' : 'NO (1 flat phase)'}`);
  console.log(`   full spec keys: ${Object.keys(s).join(', ')}`);
  console.log('');
}

await pool.end();
