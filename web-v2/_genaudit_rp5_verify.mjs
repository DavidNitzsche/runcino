import fs from 'node:fs';
import pg from 'pg';
const env = fs.readFileSync('.env.local','utf8');
const url = (env.match(/^DATABASE_URL_RO=(.*)$/m)||[])[1];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized:false } });
await c.connect();
const plans = await c.query(`
  SELECT tp.id::text AS pid, tp.user_uuid::text AS uid, tp.authored_iso, tp.authored_state, tp.race_id
    FROM training_plans tp
   WHERE tp.archived_iso IS NULL AND tp.mode='race-prep'
   ORDER BY tp.authored_iso DESC NULLS LAST`);
console.log(`ACTIVE race-prep plans: ${plans.rowCount}`);
for (const p of plans.rows)
  console.log(`  pid=${p.pid.slice(0,8)} u=${p.uid.slice(0,8)} race=${p.race_id} authored=${String(p.authored_iso).slice(0,10)} state=${p.authored_state}`);
const targets = plans.rows.filter(p=>p.uid.startsWith('348a7d3e')||p.uid.startsWith('de412d84'));
const DOWN=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
for (const p of targets){
  console.log(`\n===== plan ${p.pid.slice(0,8)} race=${p.race_id} =====`);
  const wk = await c.query(`
    SELECT w.week_idx, w.is_race_week, x.dow, x.type, x.distance_mi, x.sub_label
      FROM plan_workouts x JOIN plan_weeks w ON w.id=x.week_id
     WHERE w.plan_id=$1 ORDER BY w.week_idx, x.dow`,[p.pid]);
  const byWeek=new Map();
  for (const r of wk.rows){ if(!byWeek.has(r.week_idx))byWeek.set(r.week_idx,[]); byWeek.get(r.week_idx).push(r);}
  for (const [wi,rows] of [...byWeek.entries()].sort((a,b)=>a[0]-b[0])){
    const isRace=rows[0].is_race_week;
    const longMi=Math.max(0,...rows.filter(r=>r.type==='long').map(r=>Number(r.distance_mi)));
    const sum=rows.filter(r=>r.type!=='strength').reduce((s,r)=>s+Number(r.distance_mi||0),0);
    const runDays=rows.filter(r=>r.type!=='rest'&&r.type!=='strength'&&Number(r.distance_mi)>0).length;
    const maxNonLong=Math.max(0,...rows.filter(r=>r.type!=='long'&&r.type!=='strength'&&r.type!=='rest').map(r=>Number(r.distance_mi)));
    const parts=rows.filter(r=>r.type!=='rest'&&r.type!=='strength').map(r=>`${DOWN[r.dow]}:${r.type[0].toUpperCase()}${Number(r.distance_mi)}`);
    const flag=(!isRace&&longMi>0&&maxNonLong>=longMi)?'  <-- INVERSION/FLAT':'';
    console.log(`wk${wi}${isRace?' RACE':''} days=${runDays} L=${longMi} maxNonLong=${maxNonLong} sum=${sum.toFixed(1)} [${parts.join(' ')}]${flag}`);
  }
}
await c.end();
