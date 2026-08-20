import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL_RO, ssl: { rejectUnauthorized: false } });
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const p = (sec) => sec == null ? '—' : `${Math.floor(sec/60)}:${String(Math.round(sec%60)).padStart(2,'0')}`;

console.log('=== ACTIVE PLAN ===');
const act = await pool.query(`SELECT id, race_id, goal_iso, authored_iso, archived_iso FROM training_plans WHERE user_uuid=$1 ORDER BY authored_iso DESC`, [DAVID]);
for (const r of act.rows) console.log(`${r.id} race=${r.race_id} goal=${r.goal_iso} authored=${r.authored_iso?.toISOString?.() ?? r.authored_iso} archived=${r.archived_iso ?? 'ACTIVE'}`);
const active = act.rows.find(r => !r.archived_iso);
if (!active) { console.log('NO ACTIVE PLAN'); process.exit(0); }

console.log('\n=== PLAN_WEEKS cols ===');
const wc = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='plan_weeks' ORDER BY ordinal_position`);
console.log(wc.rows.map(r => r.column_name).join(', '));

console.log('\n=== PLAN WEEKS (active plan) ===');
const weeks = await pool.query(`SELECT * FROM plan_weeks WHERE plan_id=$1 ORDER BY week_index`, [active.id]).catch(() => pool.query(`SELECT * FROM plan_weeks WHERE plan_id=$1`, [active.id]));
for (const r of weeks.rows) console.log(JSON.stringify(r).slice(0, 500));

console.log('\n=== PLAN_WORKOUTS cols ===');
const pwc = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='plan_workouts' ORDER BY ordinal_position`);
console.log(pwc.rows.map(r => r.column_name).join(', '));

console.log('\n=== ALL PLAN WORKOUTS (active plan) ===');
const wos = await pool.query(`SELECT * FROM plan_workouts WHERE plan_id=$1 ORDER BY date_iso`, [active.id]);
console.log(`count=${wos.rows.length}`);
// weekly rollup
const byWeek = new Map();
for (const r of wos.rows) {
  const d = String(r.date_iso).slice(0,10);
  const dt = new Date(d + 'T00:00:00Z');
  const dow = dt.getUTCDay(); // 0 Sun
  const monOffset = (dow + 6) % 7;
  const mon = new Date(dt); mon.setUTCDate(dt.getUTCDate() - monOffset);
  const wk = mon.toISOString().slice(0,10);
  if (!byWeek.has(wk)) byWeek.set(wk, { mi: 0, days: [] });
  const w = byWeek.get(wk);
  w.mi += Number(r.distance_mi ?? 0);
  w.days.push(`${d.slice(5)} ${r.type}${r.distance_mi ? ' ' + r.distance_mi + 'mi' : ''}${r.sub_label ? ' [' + r.sub_label + ']' : ''}`);
}
for (const [wk, w] of [...byWeek.entries()].sort()) {
  console.log(`WEEK of ${wk}: ${w.mi.toFixed(1)} mi`);
  for (const d of w.days) console.log(`   ${d}`);
}

console.log('\n=== JUL 19 + AUG 10-16 WORKOUT SPECS (verbatim) ===');
for (const r of wos.rows) {
  const d = String(r.date_iso).slice(0,10);
  if (d === '2026-07-19' || (d >= '2026-08-09' && d <= '2026-08-16')) {
    console.log(`--- ${d} ---`);
    console.log(JSON.stringify(r, null, 1).slice(0, 1800));
  }
}
await pool.end();
