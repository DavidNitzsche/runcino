import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const uid = '0645f40c-951d-4ccc-b86e-9979cd26c795';

// Race-day run splits: mile 1 pace
const r = await pool.query(`
  SELECT id, data->>'date' d, data->>'distanceMi' dm, data->>'workoutType' wt,
         data->'splits' splits, data->>'source' src, data->>'avgHr' ahr, data->>'maxHr' mhr
  FROM runs WHERE user_uuid=$1 AND NOT (data ? 'mergedIntoId')
    AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) = '2026-08-16'`, [uid]);
for (const row of r.rows) {
  console.log(`run ${row.id} ${row.d} ${row.dm}mi wt=${row.wt} src=${row.src} avgHr=${row.ahr} maxHr=${row.mhr}`);
  const sp = row.splits;
  if (Array.isArray(sp)) {
    sp.slice(0, 14).forEach((s, i) => console.log(`  mi${i+1}:`, JSON.stringify(s)));
  } else console.log('  splits:', sp ? JSON.stringify(sp).slice(0,500) : null);
}

// watch completion phases for race day (actual paces per phase)
const wc = await pool.query(`
  SELECT id, ts, value::jsonb->'phases' phases FROM coach_intents
  WHERE COALESCE(user_uuid, user_id::uuid)=$1 AND reason='watch_completion'
    AND ts >= '2026-08-16' AND ts < '2026-08-18' ORDER BY id DESC LIMIT 1`, [uid]).catch(e=>({rows:[],err:e.message}));
if (wc.err) console.log('wc err', wc.err);
for (const row of wc.rows) {
  console.log('\nwatch completion', row.ts);
  const ph = row.phases;
  if (Array.isArray(ph)) for (const p of ph) console.log(' ', JSON.stringify({type:p.type,label:p.label,dist:p.actualDistanceMi??p.distanceMi,target:p.targetPaceSPerMi,actual:p.actualPaceSPerMi}));
}

// goal-gap trail: did drift proposals fire for AFC? check plan proposals
const props = await pool.query(`
  SELECT id, created_at::text, kind, status, reasons->>'drift_kind' dk, reasons->>'message' msg
  FROM plan_change_proposals WHERE user_uuid=$1 AND created_at >= '2026-06-01'
  ORDER BY created_at DESC LIMIT 25`, [uid]).catch(e=>({rows:[],err:e.message}));
if (props.err) {
  console.log('\nproposals err:', props.err);
  const t = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_name ILIKE '%propos%' OR table_name ILIKE '%drift%'`);
  console.log('tables:', t.rows.map(x=>x.table_name));
} else {
  console.log('\n=== plan proposals since Jun 1 ===');
  for (const p of props.rows) console.log(`${p.created_at} ${p.kind} ${p.status} drift=${p.dk} :: ${(p.msg??'').slice(0,110)}`);
}

await pool.end();
