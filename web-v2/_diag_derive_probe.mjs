import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const r = await pool.query(`SELECT data->'phases' phases FROM runs WHERE id=$1`, ['-71886754295643']);
const phases = r.rows[0].phases || [];
// Replicate deriveSplitsFromPaceSamples exactly
const flat = []; let distOffset=0, tOffset=0;
for (const phase of phases) {
  const ps = phase.paceSamples ?? [];
  const hs = phase.hrSamples ?? [];
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
    const guardOk = elapsed>=120 && elapsed<=3600;
    splits.push({mile:mileNo, elapsed, pace:`${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,'0')}`, guardOk});
    prevCrossT=crossT; mileNo++;
  }
}
console.log('=== WATCH paceSamples → derived splits (the CLEAN source) ===');
splits.forEach(s=>console.log(`mile ${s.mile}: ${s.pace} (${s.elapsed}s)${s.guardOk?'':' [dropped by 120-3600 guard]'}`));
console.log('\n=== vs STORED (iPhone HK route) mile 2 = 5:44 ===');
await pool.end();
