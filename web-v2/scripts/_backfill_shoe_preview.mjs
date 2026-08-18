// 16-B backfill PREVIEW (read-only). Lists remaining null watch/HK runs and
// the exact UPDATE per run, using the SAME resolver as the live hook
// (day_actions pick → recommendShoe(planType)). Prints SQL only — executes nothing.
import fs from 'node:fs';
import pg from 'pg';
const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const RO = (env.match(/^DATABASE_URL_RO=(.*)$/m)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
if (!RO || !/faff_readonly/.test(RO)) { console.error('REFUSING: need faff_readonly'); process.exit(1); }
const D = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const p = new pg.Pool({ connectionString: RO });

const PLAN_TO_SHOE = { easy:'easy', recovery:'recovery', shakeout:'recovery', long:'long',
  tempo:'tempo', threshold:'tempo', race_week_tuneup:'tempo', interval:'intervals',
  intervals:'intervals', vo2max:'intervals', race:'race' };
const mapType = t => (!t ? 'easy' : (PLAN_TO_SHOE[t.toLowerCase()] ?? 'easy'));

const miles = new Map((await p.query(
  `WITH pd AS (SELECT shoe_id, COALESCE(data->>'date',LEFT(data->>'startLocal',10))::date d,
     MAX((data->>'distanceMi')::numeric) mi FROM runs WHERE user_uuid=$1 AND shoe_id IS NOT NULL
     AND NOT (data?'mergedIntoId') GROUP BY shoe_id,2)
   SELECT shoe_id, SUM(mi) t FROM pd GROUP BY shoe_id`, [D])).rows.map(r => [Number(r.shoe_id), Number(r.t)]));
const garage = (await p.query(
  `SELECT id, brand||' '||model name, run_types, COALESCE(preferred,false) preferred
     FROM shoes WHERE user_uuid=$1 AND COALESCE(retired,false)=false ORDER BY id`, [D])).rows
  .map(s => ({ id: Number(s.id), name: s.name, runTypes: s.run_types || [], preferred: s.preferred, mileage: miles.get(Number(s.id)) || 0 }));
const byMi = (a, b) => a.mileage - b.mileage;
function rec(want) {
  const tg = (s, t) => (s.runTypes || []).some(x => String(x).toLowerCase() === t);
  let c = garage.filter(s => tg(s, want)).sort(byMi); if (c.length) return c[0];
  c = garage.filter(s => tg(s, 'as_needed')).sort(byMi); if (c.length) return c[0];
  c = garage.filter(s => s.preferred).sort(byMi); if (c.length) return c[0];
  return garage.slice().sort(byMi)[0] ?? null;
}
const picks = new Map((await p.query(
  `SELECT date_iso, note FROM day_actions WHERE COALESCE(user_uuid,user_id)=$1 AND action='shoe'`, [D]))
  .rows.map(r => [r.date_iso, Number(r.note)]));
const planTypes = new Map((await p.query(
  `SELECT pw.date_iso, pw.type FROM plan_workouts pw JOIN training_plans tp ON tp.id=pw.plan_id
     WHERE tp.user_uuid=$1 AND tp.archived_iso IS NULL`, [D])).rows.map(r => [r.date_iso, r.type]));
const nameById = new Map(garage.map(s => [s.id, s.name]));

const rows = (await p.query(
  `SELECT id::text id, COALESCE(data->>'date',LEFT(data->>'startLocal',10)) d, data->>'source' src,
          ROUND((data->>'distanceMi')::numeric,2) mi
     FROM runs WHERE user_uuid=$1 AND shoe_id IS NULL AND NOT (data?'mergedIntoId')
       AND absorbed_into_canonical_at IS NULL
       AND data->>'source' IN ('watch','apple_watch','apple_health')
     ORDER BY d DESC`, [D])).rows;

console.log(`\n=== Remaining null watch/HK runs: ${rows.length} ===\n`);
const summary = [], stmts = [];
for (const r of rows) {
  const pick = picks.get(r.d);
  let shoeId, via;
  if (pick && nameById.has(pick)) { shoeId = pick; via = 'day_actions pick'; }
  else { const st = mapType(planTypes.get(r.d)); const rc = rec(st); shoeId = rc?.id; via = `recommend(${st})`; }
  summary.push({ date: r.d, src: r.src, mi: Number(r.mi), planned: planTypes.get(r.d) ?? '(none)', via, assign: shoeId ? `#${shoeId} ${nameById.get(shoeId)}` : '(none)' });
  if (shoeId) stmts.push(`UPDATE runs SET shoe_id = ${shoeId}, shoe_auto_assigned_at = NOW()\n  WHERE id = ${r.id} AND user_uuid = '${D}' AND shoe_id IS NULL;  -- ${r.d} ${r.src} ${r.mi}mi · ${via}`);
}
console.table(summary);
console.log(`\n=== ${stmts.length} UPDATE statements (per-statement approval) ===\n`);
console.log(stmts.join('\n'));
await p.end();
