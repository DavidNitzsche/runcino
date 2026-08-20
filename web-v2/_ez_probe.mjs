import { Pool } from 'pg';
const U = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: process.env.DATABASE_URL_RO || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const fmt = s => s == null ? '—' : `${Math.floor(s/60)}:${String(Math.round(s%60)).padStart(2,'0')}`;

// 1. current VDOT anchor
const v = await pool.query(
  `SELECT snapshot_date, vdot, vdot_anchor_date, vdot_anchor_distance_mi, source
   FROM projection_snapshots WHERE user_uuid=$1 ORDER BY snapshot_date DESC LIMIT 3`, [U]);
console.log('== CURRENT VDOT SNAPSHOTS ==');
v.rows.forEach(r => console.log(` ${r.snapshot_date.toISOString().slice(0,10)} vdot=${r.vdot} anchor=${r.vdot_anchor_date?.toISOString?.().slice(0,10)} ${r.vdot_anchor_distance_mi}mi src=${r.source}`));

// 2. what the engine PRESCRIBES on easy days (stored specs), last 90d + next 30d
const p = await pool.query(
  `SELECT date_iso, type, distance_mi,
          (workout_spec->'spec'->>'pace_target_s_per_mi_lo')::int AS lo,
          (workout_spec->'spec'->>'pace_target_s_per_mi_hi')::int AS hi,
          (workout_spec->'spec'->>'hr_cap_bpm')::int AS hrcap
   FROM plan_workouts WHERE user_uuid=$1 AND type IN ('easy','recovery')
     AND date_iso >= to_char(now() - interval '90 days','YYYY-MM-DD')
   ORDER BY date_iso DESC LIMIT 200`, [U]);
console.log(`\n== PRESCRIBED EASY/RECOVERY SPEC BANDS (${p.rowCount} rows) ==`);
const bands = new Map();
p.rows.forEach(r => { const k = `${r.type} ${r.lo}-${r.hi} hrcap=${r.hrcap}`; bands.set(k, (bands.get(k)||0)+1); });
[...bands].forEach(([k,n]) => { const [t,b] = k.split(' '); const [lo,hi] = b.split('-').map(Number);
  console.log(` ${k}  => ${fmt(lo)}-${fmt(hi)}/mi   x${n} days`); });

// 3. what he ACTUALLY runs on easy days (last 90d)
const runs = await pool.query(
  `SELECT (data->>'startLocal') AS d, (data->>'name') AS name,
          (data->>'distanceMi')::float AS mi, (data->>'paceSPerMi')::float AS pace,
          (data->>'avgHr')::float AS hr, (data->>'maxHr')::float AS mhr, (data->>'source') AS src
   FROM runs
   WHERE user_uuid=$1 AND data->>'mergedIntoId' IS NULL AND absorbed_into_canonical_at IS NULL
     AND (data->>'startLocal') >= to_char(now() - interval '90 days','YYYY-MM-DD')
     AND (data->>'distanceMi')::float > 1
   ORDER BY (data->>'startLocal') DESC`, [U]);
console.log(`\n== ALL RUNS LAST 90d (${runs.rowCount}) ==`);
console.log(' date        mi    pace    avgHr  name');
runs.rows.forEach(r => console.log(` ${r.d?.slice(0,10)}  ${String(r.mi?.toFixed(1)).padStart(4)}  ${String(fmt(r.pace)).padStart(5)}  ${String(r.hr??'—').padStart(5)}  ${(r.name||'').slice(0,44)}`));

// 4. join runs to the plan type for that date
const j = await pool.query(
  `SELECT pw.date_iso, pw.type, pw.distance_mi AS plan_mi,
          (pw.workout_spec->'spec'->>'pace_target_s_per_mi_lo')::int AS lo,
          (pw.workout_spec->'spec'->>'pace_target_s_per_mi_hi')::int AS hi,
          (pw.workout_spec->'spec'->>'hr_cap_bpm')::int AS hrcap,
          (r.data->>'distanceMi')::float AS mi, (r.data->>'paceSPerMi')::float AS pace,
          (r.data->>'avgHr')::float AS hr
   FROM plan_workouts pw
   JOIN runs r ON r.user_uuid=pw.user_uuid AND substr(r.data->>'startLocal',1,10)=pw.date_iso
   WHERE pw.user_uuid=$1 AND pw.type IN ('easy','recovery','long')
     AND r.data->>'mergedIntoId' IS NULL AND r.absorbed_into_canonical_at IS NULL
     AND pw.date_iso >= to_char(now() - interval '90 days','YYYY-MM-DD')
   ORDER BY pw.date_iso DESC`, [U]);
console.log(`\n== EXECUTED vs PRESCRIBED on easy/long days (${j.rowCount}) ==`);
console.log(' date        type      planned band    ran     avgHr  hrcap  verdict');
let n=0, fasterThanLo=0, sumPace=0, sumHr=0, nHr=0;
j.rows.forEach(r => {
  const verdict = r.lo==null ? '—' : (r.pace < r.lo ? `FASTER than floor by ${Math.round(r.lo-r.pace)}s` : (r.pace > r.hi ? `slower than ceiling by ${Math.round(r.pace-r.hi)}s` : 'in band'));
  console.log(` ${r.date_iso}  ${r.type.padEnd(9)} ${(fmt(r.lo)+'-'+fmt(r.hi)).padEnd(14)} ${fmt(r.pace).padStart(5)}  ${String(Math.round(r.hr??0)||'—').padStart(5)}  ${String(r.hrcap??'—').padStart(5)}  ${verdict}`);
  if (r.type!=='long') { n++; sumPace+=r.pace; if(r.lo!=null && r.pace<r.lo) fasterThanLo++; if(r.hr){sumHr+=r.hr;nHr++;} }
});
if (n) console.log(`\n EASY/RECOVERY only: n=${n}, mean executed pace ${fmt(sumPace/n)}/mi, mean avgHr ${nHr?Math.round(sumHr/nHr):'—'}, ${fasterThanLo}/${n} ran FASTER than the prescribed floor`);
await pool.end();
