import { Pool } from 'pg';
const U = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: process.env.DATABASE_URL_RO || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const fmt = s => s == null ? '—' : `${Math.floor(s/60)}:${String(Math.round(s%60)).padStart(2,'0')}`;

// distinct easy/recovery/long prescriptions, one row per date (newest plan wins)
const p = await pool.query(
  `SELECT DISTINCT ON (date_iso) date_iso, type, plan_id, distance_mi,
          (workout_spec->>'pace_target_s_per_mi_lo')::int lo,
          (workout_spec->>'pace_target_s_per_mi_hi')::int hi,
          (workout_spec->>'hr_cap_bpm')::int hrcap
   FROM plan_workouts
   WHERE user_uuid=$1 AND type IN ('easy','recovery','long') AND workout_spec IS NOT NULL
     AND date_iso >= to_char(now() - interval '95 days','YYYY-MM-DD')
   ORDER BY date_iso DESC, id DESC`, [U]);
console.log('== DISTINCT PRESCRIBED BANDS BY TYPE (last 95d + future) ==');
const agg = new Map();
p.rows.forEach(r => { const k = `${r.type}|${r.lo}|${r.hi}|${r.hrcap}`; if(!agg.has(k)) agg.set(k,[]); agg.get(k).push(r.date_iso); });
[...agg].sort().forEach(([k, ds]) => { const [t,lo,hi,c]=k.split('|');
  console.log(` ${t.padEnd(9)} ${fmt(+lo)}-${fmt(+hi)}/mi  (${lo}-${hi}s, T+80/T+120 => T=${lo-80})  hrcap=${c}  x${ds.length}d  ${ds[ds.length-1]}..${ds[0]}`); });

// executed vs prescribed, one plan row per date
const runs = await pool.query(
  `SELECT substr(data->>'startLocal',1,10) d, (data->>'distanceMi')::float mi,
          (data->>'paceSPerMi')::float pace, (data->>'avgHr')::float hr, (data->>'name') name,
          (data->>'movingTimeS')::float mt
   FROM runs WHERE user_uuid=$1 AND data->>'mergedIntoId' IS NULL AND absorbed_into_canonical_at IS NULL
     AND substr(data->>'startLocal',1,10) >= to_char(now() - interval '90 days','YYYY-MM-DD')
     AND (data->>'distanceMi')::float > 2
   ORDER BY 1 DESC`, [U]);
const byDate = new Map(p.rows.map(r => [r.date_iso, r]));
console.log('\n== EXECUTED vs PRESCRIBED (easy/recovery days only, last 90d) ==');
console.log(' date        mi    ran     band            avgHr hrcap  delta-vs-floor');
let n=0,sum=0,sumHr=0,nHr=0,fast=0,inband=0;
for (const r of runs.rows) {
  const pl = byDate.get(r.d);
  if (!pl || pl.type === 'long') continue;
  const pace = r.pace ?? (r.mt && r.mi ? r.mt / r.mi : null);
  if (pace == null || pl.lo == null) continue;
  const delta = Math.round(pl.lo - pace);
  console.log(` ${r.d}  ${String(r.mi.toFixed(1)).padStart(4)}  ${fmt(pace).padStart(5)}  ${(fmt(pl.lo)+'-'+fmt(pl.hi)).padEnd(14)} ${String(Math.round(r.hr??0)||'—').padStart(5)} ${String(pl.hrcap??'—').padStart(5)}  ${delta>0?`${delta}s FASTER than floor`:(pace>pl.hi?`${Math.round(pace-pl.hi)}s slower than ceiling`:'in band')}`);
  n++; sum+=pace; if(r.hr){sumHr+=r.hr;nHr++;} if(delta>0)fast++; else if(pace<=pl.hi)inband++;
}
console.log(`\n n=${n}  mean executed easy pace ${fmt(sum/n)}/mi  mean avgHr ${nHr?Math.round(sumHr/nHr):'—'}  |  ${fast} ran faster than the prescribed FLOOR, ${inband} in band`);

// all easy-ish runs regardless of plan match: pace + HR distribution
console.log('\n== ALL non-quality runs last 90d with pace, sorted by pace ==');
const easyish = runs.rows.filter(r => (r.pace ?? (r.mt&&r.mi? r.mt/r.mi : null)) != null)
  .map(r => ({...r, pace: r.pace ?? r.mt/r.mi}));
easyish.sort((a,b)=>a.pace-b.pace).forEach(r => console.log(` ${r.d} ${String(r.mi.toFixed(1)).padStart(5)}mi ${fmt(r.pace)}/mi hr=${Math.round(r.hr??0)||'—'}`));
await pool.end();
