// Post-deploy falsifiers for Item 16 (shoe tracking). RO only.
import fs from 'node:fs';
import pg from 'pg';
const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const RO = (env.match(/^DATABASE_URL_RO=(.*)$/m)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
if (!RO || !/faff_readonly/.test(RO)) { console.error('REFUSING: need faff_readonly'); process.exit(1); }
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new pg.Pool({ connectionString: RO });
console.log('user:', (await pool.query('SELECT current_user')).rows[0].current_user, '\n');

// ---- #2 · whole-DB auto-assign count ----
const auto = (await pool.query(
  `SELECT COUNT(*) FILTER (WHERE shoe_auto_assigned_at IS NOT NULL) AS auto,
          COUNT(*) FILTER (WHERE shoe_id IS NOT NULL) AS any_shoe FROM runs`)).rows[0];
console.log(`#2 auto-assigned (whole DB): ${auto.auto}   (any shoe: ${auto.any_shoe})`);
console.log(`   → fires on the next watch/HK ingest (afterRunWrite). 0 here = no new run since deploy.\n`);

// ---- #3 · on-read mileage == canonical run-sum (vs the stored fiction) ----
const miles = new Map((await pool.query(
  `WITH per_day AS (
     SELECT shoe_id, COALESCE(data->>'date', LEFT(data->>'startLocal',10))::date d,
            MAX((data->>'distanceMi')::numeric) mi
       FROM runs WHERE user_uuid=$1 AND shoe_id IS NOT NULL AND NOT (data ? 'mergedIntoId')
      GROUP BY shoe_id,2)
   SELECT shoe_id, ROUND(SUM(mi),2) total FROM per_day GROUP BY shoe_id`, [DAVID])
).rows.map(r => [Number(r.shoe_id), Number(r.total)]));
const shoes = (await pool.query(
  `SELECT id, brand||' '||model AS name, run_types, preferred,
          mileage::numeric AS stored FROM shoes
     WHERE user_uuid=$1 AND COALESCE(retired,false)=false ORDER BY id`, [DAVID])).rows;
console.log('#3 stored column (fiction) vs ON-READ (what the deployed endpoint now serves):');
console.table(shoes.map(s => ({
  id: s.id, shoe: s.name,
  stored_mi: Number(s.stored), onread_mi: miles.get(Number(s.id)) ?? 0,
  fiction_gone: Number(s.stored) !== (miles.get(Number(s.id)) ?? 0) ? 'now run-sum' : 'same',
})));

// ---- #1 · resolver simulation against the real null watch runs ----
// Faithful replica of lib/shoe/auto-assign.ts: day_actions pick → recommendShoe.
const PLAN_TO_SHOE = { easy:'easy', recovery:'recovery', shakeout:'recovery', long:'long',
  tempo:'tempo', threshold:'tempo', race_week_tuneup:'tempo', interval:'intervals',
  intervals:'intervals', vo2max:'intervals', race:'race' };
const mapType = t => (!t ? 'easy' : (PLAN_TO_SHOE[t.toLowerCase()] ?? 'easy'));
const garage = shoes.map(s => ({ id: Number(s.id), name: s.name,
  runTypes: s.run_types ?? [], preferred: s.preferred, mi: miles.get(Number(s.id)) ?? 0 }));
const byMi = (a, b) => a.mi - b.mi;
function recommend(want) {
  const tagged = (s, t) => (s.runTypes ?? []).some(x => String(x).toLowerCase() === t);
  let c = garage.filter(s => tagged(s, want)).sort(byMi); if (c.length) return c[0];
  c = garage.filter(s => tagged(s, 'as_needed')).sort(byMi); if (c.length) return c[0];
  c = garage.filter(s => s.preferred).sort(byMi); if (c.length) return c[0];
  return garage.slice().sort(byMi)[0] ?? null;
}
const nullRuns = (await pool.query(
  `SELECT COALESCE(data->>'date', LEFT(data->>'startLocal',10)) d, data->>'source' src,
          ROUND((data->>'distanceMi')::numeric,2) mi
     FROM runs WHERE user_uuid=$1 AND shoe_id IS NULL AND NOT (data ? 'mergedIntoId')
       AND absorbed_into_canonical_at IS NULL AND data->>'source' IN ('watch','apple_watch')
     ORDER BY d DESC LIMIT 8`, [DAVID])).rows;
const picks = new Map((await pool.query(
  `SELECT date_iso, note FROM day_actions WHERE COALESCE(user_uuid,user_id)=$1 AND action='shoe'`,
  [DAVID])).rows.map(r => [r.date_iso, Number(r.note)]));
const planTypes = new Map((await pool.query(
  `SELECT pw.date_iso, pw.type FROM plan_workouts pw JOIN training_plans tp ON tp.id=pw.plan_id
     WHERE tp.user_uuid=$1 AND tp.archived_iso IS NULL`, [DAVID])).rows.map(r => [r.date_iso, r.type]));
const nameById = new Map(garage.map(s => [s.id, s.name]));
console.log('\n#1 resolver SIMULATION (read-only) — what each null watch run WOULD get on ingest:');
console.table(nullRuns.map(r => {
  const pick = picks.get(r.d);
  if (pick && nameById.has(pick)) return { date: r.d, mi: Number(r.mi), planned: planTypes.get(r.d) ?? '(none)', via: 'day_actions pick', would_assign: `#${pick} ${nameById.get(pick)}` };
  const st = mapType(planTypes.get(r.d));
  const rec = recommend(st);
  return { date: r.d, mi: Number(r.mi), planned: planTypes.get(r.d) ?? '(none)', via: `recommend(${st})`, would_assign: rec ? `#${rec.id} ${rec.name}` : '(none)' };
}));
console.log('\n(These existing runs need 16-B backfill to actually get the shoe; NEW ingests get it live via afterRunWrite.)');
await pool.end();
