import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL_RO, ssl: { rejectUnauthorized: false } });
const fmt = (sec) => {
  if (sec == null) return 'null';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
};

console.log('=== USERS ===');
const users = await pool.query(`SELECT id, email, name, level, max_hr, resting_hr, timezone, vdot_manual_override, is_admin FROM users ORDER BY created_at ASC`);
for (const r of users.rows) console.log(`id=${String(r.id).slice(0,8)} name=${r.name} email=${r.email} level=${r.level} maxHr=${r.max_hr} rhr=${r.resting_hr} tz=${r.timezone} vdotOverride=${r.vdot_manual_override}`);

console.log('\n=== PROFILE ===');
const prof = await pool.query(`SELECT user_uuid, full_name, hrmax, hrmax_observed, rhr, lthr, lthr_method, experience_level, goal_race_distance, goal_race_date, goal_race_time, weekly_mileage_target, timezone FROM profile`);
for (const r of prof.rows) console.log(JSON.stringify(r));

console.log('\n=== RACES ===');
const races = await pool.query(`SELECT slug, user_uuid, meta, actual_result FROM races ORDER BY (meta->>'date')`);
for (const r of races.rows) {
  console.log(`slug=${r.slug} user=${String(r.user_uuid).slice(0,8)}`);
  console.log(`  meta=${JSON.stringify(r.meta).slice(0, 700)}`);
  if (r.actual_result) console.log(`  actual_result=${JSON.stringify(r.actual_result).slice(0, 300)}`);
}

console.log('\n=== PROJECTION SNAPSHOTS (latest 14) ===');
const snapCols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='projection_snapshots' ORDER BY ordinal_position`);
console.log('cols:', snapCols.rows.map(r => r.column_name).join(', '));
const snaps = await pool.query(`SELECT * FROM projection_snapshots ORDER BY snapshot_date DESC LIMIT 14`);
for (const r of snaps.rows) {
  const d = r.snapshot_date instanceof Date ? r.snapshot_date.toISOString().slice(0,10) : r.snapshot_date;
  console.log(`${d} dist=${r.distance_mi} vdot=${r.vdot} proj=${r.projection_sec}s=${fmt(r.projection_sec)} ${r.source ?? ''} ${r.anchor_slug ?? ''}`);
}

console.log('\n=== TRAINING PLANS ===');
const plans = await pool.query(`SELECT id, user_uuid, race_id, created_at IS NOT NULL as has_created, archived_iso, archive_reason, meta FROM training_plans ORDER BY id DESC LIMIT 6`).catch(async e => {
  const c = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='training_plans' ORDER BY ordinal_position`);
  console.log('cols:', c.rows.map(r => r.column_name).join(', '));
  return pool.query(`SELECT * FROM training_plans ORDER BY 1 DESC LIMIT 4`);
});
for (const r of plans.rows) console.log(JSON.stringify(r).slice(0, 800));

await pool.end();
