import pg from 'pg';
import fs from 'node:fs';
const env = fs.readFileSync('.env.local','utf8');
const url = (env.match(/^DATABASE_URL_RO=(.*)$/m)||[])[1]?.replace(/^["']|["']$/g,'')
         || (env.match(/^DATABASE_URL=(.*)$/m)||[])[1]?.replace(/^["']|["']$/g,'');
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized:false } });
await c.connect();
const DOW=['Su','Mo','Tu','We','Th','Fr','Sa'];
const DAYKEY={sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6,Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};

// training-week boundary = day AFTER long_run_day (matches /api/plan/week)
function weekStartISO(dateISO, lrDow){
  const boundary = (lrDow+1)%7;
  const d = new Date(dateISO+'T12:00:00Z');
  const dow = d.getUTCDay();
  const shift = -(((dow-boundary)%7+7)%7);
  d.setUTCDate(d.getUTCDate()+shift);
  return d.toISOString().slice(0,10);
}

const plans = await c.query(`
  SELECT tp.id, tp.user_uuid, tp.mode, u.email,
         p.weekly_frequency, p.experience_level,
         COALESCE(up.long_run_day, u.long_run_day) AS long_run_day,
         COALESCE(up.rest_day, u.rest_day) AS rest_day,
         u.quality_days AS quality_days
    FROM training_plans tp
    LEFT JOIN users u ON u.id = tp.user_uuid
    LEFT JOIN profile p ON p.user_uuid = tp.user_uuid
    LEFT JOIN user_prefs up ON up.user_uuid = tp.user_uuid
   WHERE tp.archived_iso IS NULL
   ORDER BY u.email NULLS LAST, tp.id`);

console.log(`ACTIVE PLANS: ${plans.rows.length}`);

let T_inv=0, T_gap=0, T_mis=0, T_nonprog=0, plansAny=0;

for (const pl of plans.rows) {
  const lrDow = DAYKEY[pl.long_run_day] ?? 6;
  const wq = await c.query(`
    SELECT date_iso, dow, type, distance_mi, is_long, is_quality, sub_label
      FROM plan_workouts WHERE plan_id=$1 ORDER BY date_iso, dow`, [pl.id]);
  if (!wq.rows.length) continue;

  // bucket by date-derived training week
  const byWeek = new Map();
  for (const r of wq.rows){
    const ws = weekStartISO(r.date_iso, lrDow);
    if(!byWeek.has(ws)) byWeek.set(ws,[]);
    byWeek.get(ws).push(r);
  }
  const weeks = [...byWeek.keys()].sort();

  let pInv=0,pGap=0,pMis=0,pNonprog=0;
  const longSeries=[];
  const lines=[];
  for (let wi=0; wi<weeks.length; wi++){
    const ws=weeks[wi];
    const days=byWeek.get(ws);
    const runDays=days.filter(d=>d.type!=='rest' && Number(d.distance_mi)>0);
    const longRows=days.filter(d=>d.is_long || d.type==='long');
    const longMi=longRows.length?Math.max(...longRows.map(d=>Number(d.distance_mi))):0;
    longSeries.push(longMi);

    // (b) inversion: a non-long, non-race RUN day distance >= the long
    const inv=runDays.filter(d=>!d.is_long && d.type!=='long' && d.type!=='race' && longMi>0 && Number(d.distance_mi)>=longMi);
    pInv+=inv.length;

    // also flag: is the long actually the single max? (strict primacy)
    const maxRun=runDays.length?Math.max(...runDays.map(d=>Number(d.distance_mi))):0;
    const longIsMax = longMi>0 && longMi>=maxRun;

    // (a) 3+ consecutive rest among run days (wrap-aware over 7 dows)
    const runDowSet=new Set(runDays.map(d=>d.dow));
    const present=[]; for(let i=0;i<7;i++) present.push(runDowSet.has(i));
    let maxGap=0,cur=0; const dbl=present.concat(present);
    for(let i=0;i<dbl.length;i++){ if(!dbl[i]){cur++; if(cur>maxGap)maxGap=cur;} else cur=0; }
    if(maxGap>7)maxGap=7;
    const gap3=(runDays.length>=2 && maxGap>=3);
    if(gap3)pGap++;

    // (c) race-week chronology: this is the LAST week and contains a race row
    const isLast = (wi===weeks.length-1);
    const raceRow=days.find(d=>d.type==='race');
    if(isLast && raceRow){
      const boundary=(lrDow+1)%7;
      const pos=(dw)=>(((dw-boundary)%7)+7)%7;
      const racePos=pos(raceRow.dow);
      const tuneups=days.filter(d=>d.type==='race_week_tuneup'||d.type==='shakeout');
      for(const t of tuneups){ if(pos(t.dow)>=racePos) pMis++; }
    }

    const cells=days.slice().sort((a,b)=>a.dow-b.dow).map(d=>{
      const t=d.type==='rest'?'rest':d.type.slice(0,4);
      return `${DOW[d.dow]}:${t}:${Number(d.distance_mi).toFixed(1)}${d.is_long?'*':''}`;
    }).join(' ');
    const fl=[]; if(inv.length)fl.push(`INV${inv.length}`); if(gap3)fl.push(`GAP${maxGap}`); if(!longIsMax&&longMi>0)fl.push('NOTMAX');
    lines.push(`  w${wi} ${ws} long=${longMi} runs=${runDays.length} ${fl.join(',')} [${cells}]`);
  }

  // non-progression: long run never increases across the whole plan (max==min, build plans only)
  const lmax=Math.max(...longSeries), lmin=Math.min(...longSeries.filter(x=>x>0).concat([lmax]));
  const nonProg = (pl.mode==='race-prep' && longSeries.length>=4 && lmax<=lmin+0.01);
  if(nonProg){ pNonprog=1; T_nonprog++; }

  T_inv+=pInv; T_gap+=pGap; T_mis+=pMis;
  if(pInv||pGap||pMis||pNonprog) plansAny++;

  if(pInv||pGap||pMis||pNonprog){
    console.log(`\n=== ${pl.email||pl.user_uuid} | ${pl.id} | mode=${pl.mode} freq=${pl.weekly_frequency} exp=${pl.experience_level} | LRD=${pl.long_run_day} rest=${pl.rest_day} q=${pl.quality_days}`);
    console.log(`    INV=${pInv} GAP3wk=${pGap} RACEWK_MISORDER=${pMis} NONPROG=${pNonprog} longSeries=[${longSeries.join(',')}]`);
    for(const l of lines){ if(/INV|GAP|NOTMAX/.test(l)) console.log(l); }
  }
}

console.log(`\n──────── TOTALS ────────`);
console.log(`active plans: ${plans.rows.length}`);
console.log(`plans with any defect: ${plansAny}`);
console.log(`easy>=long inversion day-rows: ${T_inv}`);
console.log(`weeks with 3+ consecutive rest among run days: ${T_gap}`);
console.log(`race-week tuneup/shakeout on-or-after race day: ${T_mis}`);
console.log(`race-prep plans whose long NEVER progresses: ${T_nonprog}`);

await c.end();
