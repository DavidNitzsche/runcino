import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL_RO, ssl: { rejectUnauthorized: false } });
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

// ─── exact replicas of lib/training/vdot.ts ───
const kmFromMi = (mi) => mi * 1.609344;
const vo2Cost = (v) => -4.6 + 0.182258 * v + 0.000104 * v * v;
const pctVO2 = (min) => 0.8 + 0.1894393 * Math.exp(-0.012778 * min) + 0.2989558 * Math.exp(-0.1932605 * min);
function rawVdot(sec, mi) {
  if (!sec || sec <= 0 || !mi || mi <= 0) return null;
  const speed = (kmFromMi(mi) * 1000) / (sec / 60);
  const v = vo2Cost(speed) / pctVO2(sec / 60);
  return isFinite(v) ? v : null;
}
function vdotFromRace(sec, mi) {
  if (!sec || sec < 60) return null;
  const v = rawVdot(sec, mi);
  if (v == null || v < 30 || v > 85) return null;
  return Math.round(v * 10) / 10;
}
function predictRaceTime(vdot, mi) {
  if (!vdot || vdot <= 0 || !mi || mi <= 0) return null;
  let lo = mi * 150, hi = mi * 1500, mid = (lo + hi) / 2;
  for (let i = 0; i < 60; i++) {
    mid = (lo + hi) / 2;
    const v = rawVdot(mid, mi);
    if (v == null) break;
    if (v > vdot) lo = mid; else hi = mid;
  }
  return Math.round(mid);
}
const QUALITY = new Set(['threshold','tempo','cruise','intervals','vo2','vo2max','marathon_pace','mp','race','time_trial','tune_up']);
const STRAVA_WT = { '1': 'race', '3': 'tempo' };
function vdotFromRun({ finishSeconds, distanceMi, workoutType, avgHr, maxHr }) {
  if (!finishSeconds || finishSeconds < 60) return null;
  if (!distanceMi || distanceMi < 4) return null;
  const isQ = QUALITY.has(String(workoutType ?? '').toLowerCase());
  const hard = avgHr != null && maxHr != null && avgHr >= maxHr * 0.80;
  if (!isQ && !hard) return null;
  return vdotFromRace(finishSeconds, distanceMi);
}
const fmt = (sec) => {
  if (sec == null) return 'null';
  sec = Math.round(sec);
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
};
const pace = (sPerMi) => sPerMi == null ? '—' : `${Math.floor(sPerMi/60)}:${String(Math.round(sPerMi%60)).padStart(2,'0')}/mi`;

// ════ PART A · VDOT ════
console.log('════ A. VDOT VERIFICATION ════');
const raceRows = (await pool.query(`SELECT slug, meta, actual_result FROM races WHERE user_uuid=$1`, [DAVID])).rows;
const races = raceRows.map(r => ({
  slug: r.slug, name: r.meta?.name, date: r.meta?.date, priority: r.meta?.priority,
  distance_mi: r.meta?.distanceMi ? Number(r.meta.distanceMi) : null,
  finish_seconds: r.actual_result?.finishS != null ? Number(r.actual_result.finishS) : null,
}));
console.log('Per-race recomputed VDOT (regardless of filters):');
for (const r of races) {
  if (!r.finish_seconds || !r.distance_mi) { console.log(`  ${r.slug}: no result`); continue; }
  const raw = rawVdot(r.finish_seconds, r.distance_mi);
  console.log(`  ${r.date} ${r.name} [${r.priority}] ${fmt(r.finish_seconds)} @ ${r.distance_mi}mi → VDOT ${raw?.toFixed(3)} (rounded ${vdotFromRace(r.finish_seconds, r.distance_mi)})`);
}
console.log(`\npredictRaceTime(47.9, 13.1) = ${predictRaceTime(47.9, 13.1)}s = ${fmt(predictRaceTime(47.9, 13.1))}  (displayed 1:34:54 = 5694s)`);
console.log(`predictRaceTime(47.9, 26.2) = ${fmt(predictRaceTime(47.9, 26.2))}  (displayed 3:17:31 = 11851s)`);

// effective max HR
const u = (await pool.query(`SELECT max_hr, max_hr_override FROM users WHERE id=$1`, [DAVID])).rows[0];
console.log(`\nusers.max_hr=${u.max_hr} override=${u.max_hr_override}`);
const MAXHR = Number(u.max_hr_override ?? u.max_hr ?? 181);

// run candidates exactly like loadVdotInputs (parameterized by 'today')
async function runCandidates(today) {
  const cutoff = new Date(Date.parse(today + 'T12:00:00Z') - 60 * 86400000).toISOString().slice(0, 10);
  const rows = (await pool.query(
    `SELECT sa.id::text AS id,
            COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10)) AS date,
            sa.data->>'workoutType' AS workout_type,
            (sa.data->>'distanceMi')::numeric AS distance_mi,
            COALESCE((sa.data->>'durationSec')::numeric,(sa.data->>'movingTimeS')::numeric,(sa.data->>'movingSec')::numeric,(sa.data->>'elapsedTimeS')::numeric) AS finish_seconds,
            (sa.data->>'avgHr')::numeric AS avg_hr
       FROM runs sa
      WHERE sa.user_uuid = $1
        AND NOT (sa.data ? 'mergedIntoId')
        AND COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10)) >= $2
        AND COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10)) <  $3
        AND (sa.data->>'distanceMi')::numeric >= 4
        AND (sa.data->>'movingTimeS')::numeric > 60
        AND NOT EXISTS (
          SELECT 1 FROM races rr
           WHERE rr.user_uuid = $1
             AND ABS((rr.meta->>'date')::date - COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10))::date) <= 1
        )`, [DAVID, cutoff, today])).rows;
  return rows.map(r => ({
    id: r.id, date: r.date,
    workout_type: r.workout_type != null ? (STRAVA_WT[r.workout_type] ?? r.workout_type) : null,
    distance_mi: Number(r.distance_mi), finish_seconds: Number(r.finish_seconds),
    avg_hr: r.avg_hr != null ? Number(r.avg_hr) : null, max_hr: MAXHR,
  }));
}

function bestRecent(today, races, runs) {
  const cutoff = new Date(Date.parse(today + 'T12:00:00Z') - 180 * 86400000).toISOString().slice(0, 10);
  const cands = [];
  for (const r of races) {
    if (!r.date || !r.distance_mi || !r.finish_seconds) continue;
    if (r.date < cutoff || r.date >= today) continue;  // SQL also bounds date < today
    if (!['A','B'].includes(r.priority)) continue;      // SQL: priority IN ('A','B')
    const v = vdotFromRace(r.finish_seconds, r.distance_mi);
    if (v != null) cands.push({ src: 'race', label: r.name, date: r.date, vdot: v, key: v });
  }
  for (const r of runs) {
    if (!r.date || r.date < cutoff) continue;
    const v = vdotFromRun({ finishSeconds: r.finish_seconds, distanceMi: r.distance_mi, workoutType: r.workout_type, avgHr: r.avg_hr, maxHr: r.max_hr });
    if (v != null) cands.push({ src: 'run', label: `${r.date} ${r.distance_mi}mi ${r.workout_type ?? ''} hr${r.avg_hr ?? '—'}`, date: r.date, vdot: v, key: v - 1 });
  }
  cands.sort((a, b) => b.key - a.key);
  return cands;
}

console.log('\n── VDOT timeline simulation (what the snapshot cron would compute) ──');
for (const today of ['2026-06-09','2026-07-01','2026-07-15','2026-07-30','2026-07-31','2026-08-01','2026-08-05','2026-08-10','2026-08-15','2026-08-16']) {
  const runs = await runCandidates(today);
  const cands = bestRecent(today, races, runs);
  const best = cands[0];
  const proj = best ? predictRaceTime(best.vdot, 13.1) : null;
  console.log(`${today}: VDOT=${best?.vdot ?? 'NONE'} (${best?.src} ${best?.label}) → HM proj ${fmt(proj)}   [top3: ${cands.slice(0,3).map(c => `${c.vdot}|${c.src}|${String(c.label).slice(0,28)}`).join(' ; ')}]`);
}

console.log('\n── Any run in last 30 days beating 47.9? (all runs ≥4mi, gate applied) ──');
const recent = await runCandidates('2026-06-10');
for (const r of recent.filter(x => x.date >= '2026-05-10')) {
  const v = vdotFromRun({ finishSeconds: r.finish_seconds, distanceMi: r.distance_mi, workoutType: r.workout_type, avgHr: r.avg_hr, maxHr: r.max_hr });
  const vAll = vdotFromRace(r.finish_seconds, r.distance_mi);
  console.log(`  ${r.date} ${Number(r.distance_mi).toFixed(2)}mi ${fmt(r.finish_seconds)} type=${r.workout_type ?? '—'} avgHr=${r.avg_hr ?? '—'} → gated VDOT=${v ?? 'rejected'} (raw-if-race ${vAll})`);
}

// ════ PART B · TSB ════
console.log('\n════ B. TSB VERIFICATION ════');
const lthr = (await pool.query(`SELECT lthr FROM profile WHERE user_uuid=$1`, [DAVID])).rows[0]?.lthr ?? null;
const IF = { rest:0, shakeout:0.7, recovery:0.8, easy:0.85, long:0.95, progression:1.05, fartlek:1.1, tempo:1.15, threshold:1.15, intervals:1.25, race:1.4 };
async function formSeries(today, windowDays = 60) {
  const rows = (await pool.query(
    `WITH all_days AS (
       SELECT generate_series(($2::date - make_interval(days=>$3))::date, $2::date, '1 day'::interval)::date AS d
     ),
     daily_runs AS (
       SELECT (data->>'date')::date AS d,
              MAX((data->>'distanceMi')::numeric)::numeric AS mi,
              MAX((data->>'avgHr')::numeric)::numeric AS avg_hr
         FROM runs
        WHERE user_uuid = $1::uuid AND NOT (data ? 'mergedIntoId')
          AND (data->>'date')::date >= $2::date - make_interval(days=>$3)
        GROUP BY 1
     ),
     daily_plan AS (
       SELECT pw.date_iso::date AS d, pw.type
         FROM plan_workouts pw JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1::uuid AND tp.archived_iso IS NULL
          AND pw.date_iso::date >= $2::date - make_interval(days=>$3)
     )
     SELECT a.d::text AS d, COALESCE(r.mi,0)::text AS mi, r.avg_hr::text AS avg_hr, p.type AS inferred_type
       FROM all_days a LEFT JOIN daily_runs r ON r.d = a.d LEFT JOIN daily_plan p ON p.d = a.d
      ORDER BY a.d ASC`, [DAVID, today, windowDays])).rows;
  let ctl = 0, atl = 0; const series = [];
  for (const r of rows) {
    const mi = Number(r.mi) || 0;
    const avgHr = r.avg_hr ? Number(r.avg_hr) : null;
    const type = r.inferred_type ?? (mi >= 10 ? 'long' : avgHr && lthr && avgHr >= lthr*0.88 ? 'tempo' : avgHr && lthr && avgHr >= lthr*0.78 ? 'progression' : 'easy');
    const stress = mi * (IF[type] ?? 0.85);
    ctl = ctl * (1 - 1/42) + stress * (1/42);
    atl = atl * (1 - 1/7) + stress * (1/7);
    series.push({ d: r.d, mi, type, stress: +stress.toFixed(2), ctl, atl, tsb: ctl - atl });
  }
  return series;
}
const s60 = await formSeries('2026-06-09', 60);
const last = s60.at(-1);
console.log(`AS-SHIPPED (60d bootstrap): CTL=${Math.round(last.ctl*10)} ATL=${Math.round(last.atl*10)} TSB=${Math.round(last.ctl*10)-Math.round(last.atl*10)}`);
const s180 = await formSeries('2026-06-09', 180);
const l180 = s180.at(-1);
console.log(`FULL-HISTORY (180d seed):   CTL=${Math.round(l180.ctl*10)} ATL=${Math.round(l180.atl*10)} TSB=${Math.round(l180.ctl*10)-Math.round(l180.atl*10)}   ← bootstrap bias = ${ (Math.round(last.ctl*10)-Math.round(last.atl*10)) - (Math.round(l180.ctl*10)-Math.round(l180.atl*10)) }`);
console.log('\nLast 14 days of stress (as-shipped):');
for (const r of s60.slice(-14)) console.log(`  ${r.d} mi=${r.mi} type=${r.type ?? '—'} stress=${r.stress} ctl=${(r.ctl*10).toFixed(1)} atl=${(r.atl*10).toFixed(1)} tsb=${((r.ctl-r.atl)*10).toFixed(1)}`);

// simulate forward to race day assuming plan executed exactly
const plan = (await pool.query(
  `SELECT pw.date_iso, pw.type, pw.distance_mi FROM plan_workouts pw JOIN training_plans tp ON tp.id=pw.plan_id
    WHERE tp.user_uuid=$1 AND tp.archived_iso IS NULL AND pw.date_iso::date > '2026-06-09' ORDER BY pw.date_iso`, [DAVID])).rows;
let ctl = last.ctl, atl = last.atl;
let ctlF = l180.ctl, atlF = l180.atl;
const marks = new Set(['2026-07-26','2026-08-03','2026-08-09','2026-08-13','2026-08-15','2026-08-16']);
console.log('\nForward simulation to race day (plan executed exactly):');
for (const w of plan) {
  const stress = Number(w.distance_mi ?? 0) * (IF[w.type] ?? 0.85);
  ctl = ctl*(1-1/42) + stress/42; atl = atl*(1-1/7) + stress/7;
  ctlF = ctlF*(1-1/42) + stress/42; atlF = atlF*(1-1/7) + stress/7;
  const d = String(w.date_iso).slice(0,10);
  if (marks.has(d)) console.log(`  ${d}: shipped TSB=${Math.round(ctl*10)-Math.round(atl*10)} (CTL ${Math.round(ctl*10)} ATL ${Math.round(atl*10)})  | unbiased TSB=${Math.round(ctlF*10)-Math.round(atlF*10)}`);
}

// ════ PART C · readiness snapshots + health samples ════
console.log('\n════ C. READINESS + BIOMETRICS ════');
const rs = await pool.query(`SELECT * FROM readiness_snapshots WHERE user_uuid=$1 ORDER BY snapshot_date DESC LIMIT 5`, [DAVID]).catch(e => ({ rows: [], err: e.message }));
if (rs.rows.length) { console.log('readiness_snapshots latest:'); for (const r of rs.rows) console.log(' ', JSON.stringify(r).slice(0, 400)); }
else console.log('readiness_snapshots: none/', rs.err);
const hs = await pool.query(
  `SELECT sample_type, COUNT(*), MIN(value) AS min, MAX(value) AS max, AVG(value)::numeric(8,1) AS avg
     FROM health_samples WHERE user_id=$1 OR user_id='me' GROUP BY 1 ORDER BY 1`, [DAVID]).catch(async () => {
  const c = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='health_samples'`);
  console.log('hs cols:', c.rows.map(r => r.column_name).join(','));
  return { rows: [] };
});
for (const r of hs.rows) console.log(`  ${r.sample_type}: n=${r.count} min=${r.min} max=${r.max} avg=${r.avg}`);
const hrv = await pool.query(
  `SELECT sample_date::text AS d, value, source FROM health_samples
    WHERE (user_id=$1 OR user_id='me') AND sample_type IN ('hrv','resting_hr') AND sample_date >= '2026-05-25'
    ORDER BY sample_type, sample_date DESC LIMIT 40`, [DAVID]).catch(() => ({ rows: [] }));
console.log('recent hrv/rhr:');
for (const r of hrv.rows) console.log(`  ${r.d} ${r.value} (${r.source ?? '—'})`);

await pool.end();
