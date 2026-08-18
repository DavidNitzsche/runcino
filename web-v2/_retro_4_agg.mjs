// READ-ONLY retro probe 4: weekly planned-vs-actual + quality-day split analysis
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const uid = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const planId = 'pln_ca91f252bba50c74';

const wq = await pool.query(`SELECT w.date_iso, w.type, w.sub_label, w.distance_mi::float AS mi,
    w.pace_target_s_per_mi AS tgt, w.is_quality, w.is_long, pw.week_idx, pw.week_start_iso
  FROM plan_workouts w JOIN plan_weeks pw ON pw.id=w.week_id WHERE w.plan_id=$1 ORDER BY w.date_iso`, [planId]);

const rq = await pool.query(`SELECT COALESCE(data->>'date', LEFT(data->>'startLocal',10)) AS d,
    (data->>'distanceMi')::float AS mi,
    COALESCE((data->>'movingTimeS')::float,(data->>'durationSec')::float) AS s,
    ROUND((data->>'avgHr')::numeric) AS hr, data->>'workoutType' AS wtype,
    data->'splits' AS splits, id
  FROM runs WHERE user_uuid=$1::uuid AND NOT (data ? 'mergedIntoId')
    AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) BETWEEN '2026-06-01' AND '2026-08-16'
  ORDER BY d`, [uid]);

// bucket runs by plan week (Mon-start weeks from plan_weeks)
const weeks = {};
for (const w of wq.rows) {
  weeks[w.week_idx] ??= { start: w.week_start_iso, plannedMi: 0, workouts: [], q: 0, long: 0 };
  weeks[w.week_idx].plannedMi += w.mi || 0;
  if (w.is_quality) weeks[w.week_idx].q++;
  if (w.is_long) weeks[w.week_idx].long++;
  weeks[w.week_idx].workouts.push(w);
}
function weekIdxOf(d) {
  for (const [idx, w] of Object.entries(weeks)) {
    const s = new Date(w.start + 'T00:00:00Z'), e = new Date(s.getTime() + 7*86400e3);
    const dd = new Date(d + 'T00:00:00Z');
    if (dd >= s && dd < e) return idx;
  }
  return null;
}
const actual = {};
for (const r of rq.rows) {
  const idx = weekIdxOf(r.d);
  if (idx == null) continue;
  actual[idx] ??= { mi: 0, runs: 0, days: new Set() };
  actual[idx].mi += r.mi || 0;
  actual[idx].runs++;
  actual[idx].days.add(r.d);
}
console.log('=== weekly planned vs actual ===');
console.log('wk  start       plannedMi  actualMi  runs  ratio  plannedQ  plannedLong');
let totP = 0, totA = 0;
for (const idx of Object.keys(weeks).sort((a,b)=>a-b)) {
  const w = weeks[idx], a = actual[idx] ?? { mi: 0, runs: 0 };
  totP += w.plannedMi; totA += a.mi;
  console.log(`${String(idx).padStart(2)}  ${w.start}  ${w.plannedMi.toFixed(1).padStart(8)}  ${a.mi.toFixed(1).padStart(8)}  ${String(a.runs).padStart(4)}  ${(w.plannedMi? a.mi/w.plannedMi : 0).toFixed(2).padStart(5)}  ${w.q}         ${w.long}`);
}
console.log(`TOTAL planned=${totP.toFixed(1)} actual=${totA.toFixed(1)} ratio=${(totA/totP).toFixed(2)}`);

// quality-day matching: for each quality workout, find runs that day + splits fast miles
console.log('\n=== quality workouts: planned vs executed ===');
const fmt = s => s==null ? '-' : `${Math.floor(s/60)}:${String(Math.round(s%60)).padStart(2,'0')}`;
for (const w of wq.rows.filter(x => x.is_quality || x.is_long)) {
  const runs = rq.rows.filter(r => r.d === w.date_iso);
  const tag = w.is_quality ? 'Q' : 'L';
  if (!runs.length) { console.log(`${w.date_iso} [${tag}] ${w.type} ${w.mi}mi tgt=${fmt(w.tgt)}  -> MISSED (no run)`); continue; }
  for (const r of runs) {
    const pace = r.s && r.mi ? r.s/r.mi : null;
    let fast = '';
    const sp = Array.isArray(r.splits) ? r.splits : [];
    if (sp.length) {
      const paces = sp.map(x => x.paceSecPerMi).filter(Boolean).sort((a,b)=>a-b);
      // work-portion estimate: fastest 4 miles avg (typical T/I volume)
      const n = Math.min(4, paces.length);
      const fastAvg = paces.slice(0,n).reduce((a,b)=>a+b,0)/n;
      fast = ` fastest${n}=${fmt(fastAvg)} best=${fmt(paces[0])} splits=[${sp.map(x=>x.pace).join(',')}]`;
    }
    console.log(`${w.date_iso} [${tag}] ${w.type}(${w.sub_label ?? ''}) ${w.mi}mi tgt=${fmt(w.tgt)}  -> ran ${r.mi?.toFixed(2)}mi avg=${fmt(pace)} hr=${r.hr}${fast}`);
  }
}

await pool.end();
