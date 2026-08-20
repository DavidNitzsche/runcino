import { Pool } from 'pg';
import { writeFileSync } from 'fs';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const id = '-71886754295643';

const r = await pool.query(`SELECT data FROM runs WHERE id=$1`, [id]);
const d = r.rows[0].data;
const phases = d.phases || [];

// snapshot
writeFileSync('_backfill_jul9_snapshot.json', JSON.stringify({ id, oldSplits: d.splits, oldUnreliable: d.splits_unreliable }, null, 1));

// re-derive (with HR) — same algorithm as the watch complete route
const flat = []; let distOffset=0, tOffset=0;
for (const phase of phases) {
  const ps = phase.paceSamples ?? [], hs = phase.hrSamples ?? [];
  if (ps.length===0){ distOffset+=Number(phase.actualDistanceMi??0); tOffset+=Number(phase.actualDurationSec??0); continue; }
  const hrByT = new Map(); for (const h of hs) if (h.bpm!=null&&h.bpm>0) hrByT.set(h.tSec,h.bpm);
  for (const s of ps){ if(s.distMi==null) continue; flat.push({tSec:s.tSec+tOffset, distMi:s.distMi+distOffset, bpm:hrByT.get(s.tSec)??null}); }
  distOffset += Number(phase.actualDistanceMi ?? (ps[ps.length-1]?.distMi ?? 0));
  tOffset += Number(phase.actualDurationSec ?? (ps[ps.length-1]?.tSec ?? 0));
}
flat.sort((a,b)=>a.tSec-b.tSec);
const splits=[]; let mileNo=1, prevCrossT=0;
for (let i=1;i<flat.length;i++){
  const prev=flat[i-1], curr=flat[i]; const span=curr.distMi-prev.distMi; if(span<=0) continue;
  while(curr.distMi>=mileNo && prev.distMi<mileNo){
    const frac=(mileNo-prev.distMi)/span; const crossT=prev.tSec+frac*(curr.tSec-prev.tSec);
    const elapsed=Math.round(crossT-prevCrossT);
    if(elapsed>=120 && elapsed<=3600){
      const w=flat.filter(s=>s.tSec>=prevCrossT&&s.tSec<=crossT&&s.bpm!=null);
      const hr=w.length?Math.round(w.reduce((a,s)=>a+s.bpm,0)/w.length):null;
      splits.push({mile:mileNo, pace:`${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,'0')}`, hr, paceSecPerMi:elapsed, distanceMi:1});
    }
    prevCrossT=crossT; mileNo++;
  }
}
console.log('=== BEFORE (iPhone HK, stored) ==='); (d.splits||[]).forEach(s=>console.log(`mile ${s.mile}: ${s.pace}  hr ${s.hr}`));
console.log('\n=== AFTER (watch re-derived) ==='); splits.forEach(s=>console.log(`mile ${s.mile}: ${s.pace}  hr ${s.hr}`));
console.log('\nsnapshot saved to _backfill_jul9_snapshot.json');
console.log('newSplitsJSON:', JSON.stringify(splits));
await pool.end();
