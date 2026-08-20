import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL_RO, ssl: { rejectUnauthorized: false } });
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pace = (s) => s == null || !isFinite(s) ? '—' : `${Math.floor(s/60)}:${String(Math.round(s%60)).padStart(2,'0')}`;

// ── 1. last 35 days of runs joined to plan type ──
console.log('═══ RUNS last 35d vs PLAN (pace analysis) ═══');
const rows = (await pool.query(`
  SELECT COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10)) AS d,
         (r.data->>'distanceMi')::numeric AS mi,
         COALESCE((r.data->>'movingTimeS')::numeric,(r.data->>'durationSec')::numeric,(r.data->>'elapsedTimeS')::numeric) AS sec,
         (r.data->>'avgHr')::numeric AS hr,
         r.data->>'source' AS src,
         r.data->'phases' IS NOT NULL AS has_phases,
         r.data->'phases' AS phases
    FROM runs r
   WHERE r.user_uuid=$1 AND NOT (r.data ? 'mergedIntoId')
     AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10)) >= '2026-05-05'
   ORDER BY 1`, [DAVID])).rows;
const plan = (await pool.query(`
  SELECT pw.date_iso AS d, pw.type, pw.sub_label, pw.distance_mi, pw.pace_target_s_per_mi, pw.workout_spec
    FROM plan_workouts pw JOIN training_plans tp ON tp.id=pw.plan_id
   WHERE tp.user_uuid=$1 AND tp.archived_iso IS NULL ORDER BY 1`, [DAVID])).rows;
const planBy = new Map(plan.map(p => [String(p.d).slice(0,10), p]));
const easies = [], tempos = [];
for (const r of rows) {
  const p = planBy.get(r.d);
  const sPerMi = Number(r.sec) / Number(r.mi);
  const t = p?.type ?? '(pre-plan)';
  console.log(`${r.d} ${Number(r.mi).toFixed(2)}mi ${pace(sPerMi)}/mi hr=${r.hr ?? '—'} src=${r.src} plan=${t} ${p?.sub_label ?? ''} target=${p?.pace_target_s_per_mi ?? '—'} phases=${r.has_phases}`);
  if (t === 'easy') easies.push(sPerMi);
  if (t === 'tempo' || t === 'intervals') tempos.push({ d: r.d, sPerMi, phases: r.phases, spec: p?.workout_spec, sub: p?.sub_label });
}
if (easies.length) {
  easies.sort((a,b)=>a-b);
  const avg = easies.reduce((s,x)=>s+x,0)/easies.length;
  console.log(`\nEASY-day whole-run paces: n=${easies.length} avg=${pace(avg)} median=${pace(easies[Math.floor(easies.length/2)])} range ${pace(easies[0])}–${pace(easies.at(-1))}`);
}
console.log('\n═══ TEMPO/INTERVAL days · per-phase actuals ═══');
for (const t of tempos) {
  console.log(`--- ${t.d} (${t.sub}) spec.work pace=${t.spec?.work_pace_s_per_mi ?? t.spec?.pace_target_s_per_mi ?? JSON.stringify(t.spec)?.slice(0,120)}`);
  if (t.phases) {
    for (const ph of t.phases) {
      const aMi = ph.actualDistanceMi ?? ph.actual_distance_mi, aSec = ph.actualDurationSec ?? ph.actual_duration_sec;
      const pp = aMi > 0 ? aSec/aMi : null;
      console.log(`   ${ph.kind ?? ph.type ?? '?'} ${aMi ?? '—'}mi ${pace(pp)}/mi targetPace=${ph.paceTargetSPerMi ?? ph.targetPaceSPerMi ?? '—'} avgHr=${ph.avgHr ?? '—'}`);
    }
  } else console.log('   (no phase data)');
}

// ── 2. runs on plan REST days (TSB zero-stress bug check) ──
console.log('\n═══ Runs on plan REST days / plan-date mismatch (60d) ═══');
const mism = (await pool.query(`
  WITH daily_runs AS (
    SELECT (data->>'date')::date AS d, MAX((data->>'distanceMi')::numeric) AS mi
      FROM runs WHERE user_uuid=$1 AND NOT (data ? 'mergedIntoId')
       AND (data->>'date')::date >= '2026-04-10' GROUP BY 1
  ), daily_plan AS (
    SELECT pw.date_iso::date AS d, pw.type FROM plan_workouts pw
      JOIN training_plans tp ON tp.id=pw.plan_id
     WHERE tp.user_uuid=$1 AND tp.archived_iso IS NULL
  )
  SELECT r.d::text, r.mi, p.type FROM daily_runs r LEFT JOIN daily_plan p ON p.d=r.d
   WHERE r.mi > 0 AND (p.type IN ('rest','shakeout') OR p.type IS NULL AND r.d >= '2026-06-01')
   ORDER BY r.d`, [DAVID])).rows;
console.log(mism.length ? mism.map(r => `  ${r.d} ran ${r.mi}mi but plan type=${r.type ?? 'NO PLAN ROW'} → stress=${r.type==='rest' ? 'ZERO (bug)' : r.type==null ? 'fallback-inference' : 'low'}`).join('\n') : '  none in window (bug latent, not active)');

// ── 3. biometrics raw ──
console.log('\n═══ HRV / RHR / sleep — last 15 days raw ═══');
const hs = (await pool.query(`
  SELECT sample_type, sample_date::text AS d, value, source
    FROM health_samples WHERE user_uuid=$1 AND sample_type IN ('hrv','resting_hr','sleep_hours')
     AND sample_date >= '2026-05-25' ORDER BY sample_type, sample_date`, [DAVID])).rows;
for (const r of hs) console.log(`  ${r.sample_type} ${r.d} = ${r.value} (${r.source})`);

// ── 4. AFC course data ──
console.log('\n═══ AFC course/geometry ═══');
const cl = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='course_library'`);
console.log('course_library cols:', cl.rows.map(r=>r.column_name).join(','));
const course = await pool.query(`SELECT * FROM course_library WHERE slug ILIKE '%finest%' OR name ILIKE '%finest%' LIMIT 2`).catch(e => ({ rows: [], e: e.message }));
console.log(course.rows.length ? JSON.stringify(course.rows[0]).slice(0,500) : `no AFC row in course_library (${course.e ?? 'empty'})`);
const wr = await pool.query(`SELECT slug FROM workout_routes WHERE slug ILIKE '%finest%' LIMIT 2`).catch(e => ({ rows: [] }));
console.log('workout_routes AFC:', wr.rows.length ? JSON.stringify(wr.rows) : 'none');
// races table course geometry?
const rc = await pool.query(`SELECT meta ? 'course_geometry' AS m_geo, meta ? 'gpx' AS m_gpx, jsonb_object_keys(meta) AS k FROM races WHERE slug='americas-finest-city'`).catch(e => ({ rows: [] }));
console.log('AFC meta keys:', rc.rows.map(r=>r.k).join(', '));

// ── 5. Aug 16 watch payload preview: what's in plan_workouts for race day ──
console.log('\n═══ Race-day plan_workout row ═══');
const rd = (await pool.query(`
  SELECT pw.* FROM plan_workouts pw JOIN training_plans tp ON tp.id=pw.plan_id
   WHERE tp.user_uuid=$1 AND tp.archived_iso IS NULL AND pw.date_iso='2026-08-16'`, [DAVID])).rows;
console.log(JSON.stringify(rd[0] ?? null, null, 1));

await pool.end();
