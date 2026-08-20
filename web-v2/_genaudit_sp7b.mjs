import pg from 'pg';
import fs from 'node:fs';
const env = fs.readFileSync('.env.local','utf8');
const url = (env.match(/^DATABASE_URL_RO=(.*)$/m)||[])[1]?.replace(/^["']|["']$/g,'')||(env.match(/^DATABASE_URL=(.*)$/m)||[])[1]?.replace(/^["']|["']$/g,'');
const c = new pg.Client({ connectionString: url, ssl:{rejectUnauthorized:false} });
await c.connect();
const DAYKEY={sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6};
function ws(dateISO,lr){const b=(lr+1)%7;const d=new Date(dateISO+'T12:00:00Z');const sh=-(((d.getUTCDay()-b)%7+7)%7);d.setUTCDate(d.getUTCDate()+sh);return d.toISOString().slice(0,10);}
const plans=await c.query(`SELECT tp.id,tp.mode,u.email,COALESCE(up.long_run_day,u.long_run_day) lrd FROM training_plans tp LEFT JOIN users u ON u.id=tp.user_uuid LEFT JOIN user_prefs up ON up.user_uuid=tp.user_uuid WHERE tp.archived_iso IS NULL`);
// SP-3 apples-to-apples: inverted WEEKS, strict and non-strict, race-prep vs all
let invWeeksGE=0, invWeeksGT=0, racePrepInvWeeksGE=0;
const raceWkMis=[];
for(const pl of plans.rows){
  const lr=DAYKEY[pl.lrd]??6;
  const w=await c.query(`SELECT date_iso,dow,type,distance_mi,is_long FROM plan_workouts WHERE plan_id=$1 ORDER BY date_iso,dow`,[pl.id]);
  if(!w.rows.length)continue;
  const bw=new Map();
  for(const r of w.rows){const k=ws(r.date_iso,lr);(bw.get(k)||bw.set(k,[]).get(k)).push(r);}
  const wks=[...bw.keys()].sort();
  for(let i=0;i<wks.length;i++){
    const days=bw.get(wks[i]);
    const longRows=days.filter(d=>d.is_long);
    const longMi=longRows.length?Math.max(...longRows.map(d=>Number(d.distance_mi))):null;
    const nonLong=days.filter(d=>Number(d.distance_mi)>0&&!d.is_long&&d.type!=='race');
    const maxNL=nonLong.length?Math.max(...nonLong.map(d=>Number(d.distance_mi))):0;
    if(longMi!=null&&maxNL>=longMi){invWeeksGE++; if(pl.mode==='race-prep')racePrepInvWeeksGE++;}
    if(longMi!=null&&maxNL>longMi)invWeeksGT++;
    // race week chronology
    if(i===wks.length-1){
      const race=days.find(d=>d.type==='race');
      if(race){const b=(lr+1)%7;const pos=dw=>(((dw-b)%7)+7)%7;const rp=pos(race.dow);
        const after=days.filter(d=>(d.type==='race_week_tuneup'||d.type==='shakeout'||(d.type==='race'&&d!==race)||d.type==='easy')&&pos(d.dow)>rp);
        if(after.length)raceWkMis.push(`${pl.email} ${pl.mode}: race@dow${race.dow}(${race.distance_mi}mi) has AFTER it: ${after.map(d=>d.type+'@dow'+d.dow+':'+d.distance_mi).join(', ')}`);
      }
    }
  }
}
console.log('INVERTED WEEKS (maxNonLong>=long, SP-3 metric, date-bucketed):',invWeeksGE);
console.log('  of which race-prep mode:',racePrepInvWeeksGE);
console.log('INVERTED WEEKS strict (maxNonLong>long):',invWeeksGT);
console.log('\nRACE-WEEK rows scheduled AFTER the race (chronology violation):');
for(const m of raceWkMis)console.log('  '+m);
await c.end();
