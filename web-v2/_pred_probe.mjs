import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const uid = '0645f40c-951d-4ccc-b86e-9979cd26c795';

// 1. VDOT history Mar->Aug at 13.1: compress into runs of identical vdot
const hist = await pool.query(`
  SELECT snapshot_date::text d, vdot::float v, projection_sec ps, vdot_anchor_date::text ad, vdot_anchor_distance_mi::float adm, race_slug, source
  FROM projection_snapshots
  WHERE user_uuid=$1 AND distance_mi=13.1 AND snapshot_date >= '2026-03-01'
  ORDER BY snapshot_date`, [uid]);
let runs = [];
for (const r of hist.rows) {
  const last = runs[runs.length-1];
  if (last && last.v === r.v && last.ad === r.ad) { last.to = r.d; last.n++; }
  else runs.push({ from: r.d, to: r.d, n: 1, v: r.v, ps: r.ps, ad: r.ad, adm: r.adm, slug: r.race_slug, src: r.source });
}
console.log('=== 13.1 snapshot history (compressed runs of identical vdot+anchor) ===');
for (const s of runs) console.log(`${s.from}..${s.to} (${s.n}d) vdot=${s.v} proj=${s.ps}s anchor=${s.ad}@${s.adm}mi slug=${s.slug} src=${s.src}`);

// 2. Race-day + preceding snapshots detail
const rd = await pool.query(`
  SELECT snapshot_date::text d, distance_mi::float dm, vdot::float v, projection_sec ps, vdot_anchor_date::text ad, race_slug
  FROM projection_snapshots WHERE user_uuid=$1 AND snapshot_date BETWEEN '2026-08-10' AND '2026-08-17'
  ORDER BY snapshot_date, distance_mi`, [uid]);
console.log('\n=== race week snapshots ===');
for (const r of rd.rows) console.log(JSON.stringify(r));

// 3. Races in the 300-day window: what candidates existed
const races = await pool.query(`
  SELECT slug, meta->>'date' rdate, meta->>'priority' pri, meta->>'distanceMi' dmi, meta->>'distanceLabel' dl,
         meta->>'finishTime' ft, actual_result->>'finishS' ars, meta->>'goalDisplay' goal, meta->>'goalTime' gt
  FROM races WHERE user_uuid=$1 ORDER BY meta->>'date'`, [uid]);
console.log('\n=== races table ===');
for (const r of races.rows) console.log(JSON.stringify(r));

// 4. AFC race plan phases (pacing plan)
const afc = await pool.query(`SELECT plan FROM races WHERE user_uuid=$1 AND slug='americas-finest-city'`, [uid]);
const plan = afc.rows[0]?.plan;
console.log('\n=== AFC races.plan ===');
if (plan) {
  console.log('keys:', Object.keys(plan));
  if (plan.phases) for (const p of plan.phases) console.log(JSON.stringify(p));
  else console.log(JSON.stringify(plan).slice(0, 3000));
}

// 5. quality runs in 60d before race: were there candidates that could have moved vdot?
const qr = await pool.query(`
  SELECT COALESCE(data->>'date', LEFT(data->>'startLocal',10)) d, data->>'workoutType' wt,
         (data->>'distanceMi')::numeric dm,
         COALESCE((data->>'durationSec')::numeric,(data->>'movingTimeS')::numeric,(data->>'movingSec')::numeric,(data->>'elapsedTimeS')::numeric) sec,
         (data->>'avgHr')::numeric ahr
  FROM runs WHERE user_uuid=$1 AND NOT (data ? 'mergedIntoId')
   AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) >= '2026-06-17'
   AND (data->>'distanceMi')::numeric >= 3
  ORDER BY 1`, [uid]);
console.log('\n=== runs >=3mi since 2026-06-17 (60d window before race) ===');
for (const r of qr.rows) {
  const pace = r.sec && r.dm ? Math.round(r.sec/r.dm) : null;
  console.log(`${r.d} wt=${r.wt} ${Number(r.dm).toFixed(1)}mi ${r.sec}s pace=${pace}s/mi avgHr=${r.ahr}`);
}

// 6. AFC actual result
const res = await pool.query(`SELECT actual_result, meta->>'goalDisplay' g, meta->>'goalTime' gt2 FROM races WHERE user_uuid=$1 AND slug='americas-finest-city'`, [uid]);
console.log('\n=== AFC actual_result + goal ===');
console.log(JSON.stringify(res.rows[0]));

await pool.end();
