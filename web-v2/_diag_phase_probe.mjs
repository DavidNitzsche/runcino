import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const id = '-71886754295643';
const r = await pool.query(`SELECT data FROM runs WHERE id=$1`, [id]);
const d = r.rows[0].data;
console.log('source:', d.source, '| distanceMi:', d.distanceMi, '| durationSec:', d.durationSec ?? d.duration_sec ?? d.movingSec, '| avgPace:', d.avgPaceMinPerMi);
console.log('top-level keys:', Object.keys(d).join(', '));
console.log('\n=== phases ===');
const phases = d.phases || d.phaseBreakdown || [];
if (Array.isArray(phases)) phases.forEach((p,i)=>{
  const ps = p.paceSamples || [];
  console.log(`phase ${i}: kind=${p.kind||p.phaseKind||p.label||'?'} actualDistMi=${p.actualDistanceMi} actualDurSec=${p.actualDurationSec} paceSamples=${ps.length} distMi[first..last]=${ps[0]?.distMi}..${ps[ps.length-1]?.distMi} tSec[first..last]=${ps[0]?.tSec}..${ps[ps.length-1]?.tSec}`);
});
console.log('\n=== splits (stored) ===');
(d.splits||[]).forEach(s=>console.log(JSON.stringify(s)));
console.log('\n=== does data carry _raw / paceSamples at top level? ===');
console.log('has phases:', !!d.phases, '| has _raw:', !!d._raw, '| has paceSamples:', !!d.paceSamples, '| splitsUnreliable:', d.splits_unreliable);
await pool.end();
