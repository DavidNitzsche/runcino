// READ-ONLY diagnostic: strength scheduling audit
// Checks: (1) readiness gate state, (2) next-8-weeks plan workouts,
// (3) what recommendedStrengthDays each week would get
import { Pool } from 'pg';
import { readFileSync } from 'fs';
// Load .env.local manually
try {
  const env = readFileSync('/Volumes/WP/06 Claude Code/Runcino/web-v2/.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const uid = '0645f40c-951d-4ccc-b86e-9979cd26c795';

// ── 1. today ─────────────────────────────────────────────────────────────
const todayQ = await pool.query(`
  SELECT to_char((now() AT TIME ZONE 'America/Los_Angeles')::date,'YYYY-MM-DD') AS today_pt
`);
const today = todayQ.rows[0].today_pt;
console.log('=== today (PT):', today, '===');

// ── 2. readiness signals (last 10 days) ──────────────────────────────────
const sleepQ = await pool.query(`
  SELECT to_char(sample_date,'YYYY-MM-DD') AS d, ROUND(value::numeric,1) AS v
    FROM health_samples
   WHERE COALESCE(user_uuid, user_id) = $1::uuid AND sample_type = 'sleep_hours'
     AND sample_date >= $2::date - 9 AND value > 0
   ORDER BY sample_date DESC
`, [uid, today]);
const rhrQ = await pool.query(`
  SELECT to_char(recorded_at::date,'YYYY-MM-DD') AS d, ROUND(value::numeric,0) AS v
    FROM health_samples
   WHERE COALESCE(user_uuid, user_id) = $1::uuid AND sample_type = 'resting_hr'
     AND recorded_at::date >= $2::date - 9
   ORDER BY recorded_at DESC
`, [uid, today]);
const hrvQ = await pool.query(`
  SELECT to_char(recorded_at::date,'YYYY-MM-DD') AS d, ROUND(value::numeric,0) AS v
    FROM health_samples
   WHERE COALESCE(user_uuid, user_id) = $1::uuid AND sample_type = 'hrv'
     AND recorded_at::date >= $2::date - 9
   ORDER BY recorded_at DESC
`, [uid, today]);

console.log('\n=== health signals (last 10d, newest first) ===');
console.log('sleep:', sleepQ.rows.map(r=>`${r.d}=${r.v}h`).join(' ') || '(none)');
console.log('RHR:  ', rhrQ.rows.map(r=>`${r.d}=${r.v}`).join(' ') || '(none)');
console.log('HRV:  ', hrvQ.rows.map(r=>`${r.d}=${r.v}`).join(' ') || '(none)');

// streak detection: is there a 3+ day trending run?
function detectStreakFromRows(rows, direction) {
  if (!rows.length) return 0;
  let streak = 0;
  let prev = null;
  for (const r of rows) {
    const v = Number(r.v);
    if (isNaN(v)) break;
    if (prev === null) { prev = v; streak = 1; continue; }
    const worsening = direction === 'down' ? v < prev : v > prev;
    if (worsening) break;  // not getting worse
    prev = v; streak++;
  }
  return streak >= 3 ? streak : 0;
}
// For streaks: sleep DOWN = bad (less sleep), RHR UP = bad, HRV DOWN = bad
// readiness-brief looks at worsening trend (sleep going lower = bad)
const sleepDown = detectStreakFromRows(sleepQ.rows, 'down');
const rhrUp = detectStreakFromRows(rhrQ.rows, 'up');
const hrvDown = detectStreakFromRows(hrvQ.rows, 'down');
console.log(`\nstreaks → sleep-down:${sleepDown}d  rhr-up:${rhrUp}d  hrv-down:${hrvDown}d`);
const anyStreak = sleepDown >= 3 || rhrUp >= 3 || hrvDown >= 3;
console.log(`capAtOne (≥1 streak ≥3d): ${anyStreak}`);

// ── 2. current ACWR ─────────────────────────────────────────────────────
const acwrQ = await pool.query(`
  WITH per_day AS (
    SELECT COALESCE(data->>'date', LEFT(data->>'startLocal', 10))::date AS d,
           MAX((data->>'distanceMi')::numeric) AS mi
      FROM runs
     WHERE user_uuid = $1::uuid
       AND NOT (data ? 'mergedIntoId')
       AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10))::date >= $2::date - 28
     GROUP BY 1
  )
  SELECT COALESCE(SUM(mi) FILTER (WHERE d >= $2::date - 7), 0)::float AS acute7,
         COALESCE(SUM(mi), 0)::float AS chronic28
    FROM per_day
`, [uid, today]);
const acute7 = acwrQ.rows[0].acute7;
const chronic28 = acwrQ.rows[0].chronic28;
const acwr = chronic28 > 0 ? Math.round(acute7 / chronic28 * 7 / 28 * 100) / 100 : null;
console.log(`\nACWR: ${acwr ?? 'null (no chronic base)'}  (acute=${(acute7/7).toFixed(1)}mi/d chronic=${(chronic28/28).toFixed(1)}mi/d)`);

// ── 3. current phase ─────────────────────────────────────────────────────
const phaseQ = await pool.query(`
  SELECT tp.id AS plan_id, tp.mode,
         (SELECT ph.label FROM plan_phases ph
            JOIN plan_weeks w ON w.phase_id = ph.id
           WHERE w.plan_id = tp.id
             AND w.week_start_iso::date <= $2::date
             AND (w.week_start_iso::date + 6) >= $2::date
           LIMIT 1) AS phase_label
    FROM training_plans tp
   WHERE tp.user_uuid = $1::uuid AND tp.archived_iso IS NULL
   ORDER BY tp.authored_iso DESC LIMIT 1
`, [uid, today]);
const phase = phaseQ.rows[0];
console.log(`\nphase: mode=${phase?.mode ?? '?'}  label=${phase?.phase_label ?? '?'}  plan_id=${phase?.plan_id ?? '?'}`);

// ── 4. next 10 weeks of plan workouts ────────────────────────────────────
// Get the Monday of the current week
const mondayQ = await pool.query(`
  SELECT to_char(date_trunc('week', $1::date),'YYYY-MM-DD') AS mon
`, [today]);
const monday = mondayQ.rows[0].mon;
console.log(`\ncurrent week Mon: ${monday}`);

// Get week boundaries for next 10 weeks
const weeks = [];
for (let i = 0; i < 10; i++) {
  const d = new Date(monday + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + i * 7);
  weeks.push(d.toISOString().slice(0, 10));
}

const planId = phase?.plan_id;
if (!planId) { console.log('NO ACTIVE PLAN'); await pool.end(); process.exit(0); }

for (const wStart of weeks) {
  const wEnd = new Date(wStart + 'T12:00:00Z');
  wEnd.setUTCDate(wEnd.getUTCDate() + 6);
  const wEndISO = wEnd.toISOString().slice(0, 10);

  const days = await pool.query(`
    SELECT pw.date_iso, pw.type, pw.is_quality, pw.is_long,
           ROUND(pw.distance_mi::numeric, 1) AS mi,
           ph.label AS phase_label
      FROM plan_workouts pw
      LEFT JOIN plan_weeks wk ON wk.plan_id = pw.plan_id
                               AND pw.date_iso >= wk.week_start_iso
                               AND pw.date_iso <= (wk.week_start_iso::date + 6)::text
      LEFT JOIN plan_phases ph ON ph.id = wk.phase_id
     WHERE pw.plan_id = $1 AND pw.date_iso >= $2 AND pw.date_iso <= $3
     ORDER BY pw.date_iso ASC
  `, [planId, wStart, wEndISO]);

  // Simulate pickCandidates
  const weekDays = days.rows.map(r => ({
    date: r.date_iso,
    type: r.type,
    isQuality: Boolean(r.is_quality),
    isLong: Boolean(r.is_long),
    distanceMi: parseFloat(r.mi ?? 0),
    phaseLabel: r.phase_label,
  }));

  const hardIdxs = new Set();
  const longIdxs = new Set();
  weekDays.forEach((d, i) => {
    if (d.isQuality || d.isLong) hardIdxs.add(i);
    if (d.isLong) longIdxs.add(i);
  });

  const candidates = [];
  for (let i = 0; i < weekDays.length; i++) {
    const d = weekDays[i];
    if (['race','shakeout','race_week_tuneup'].includes(d.type)) continue;
    if (d.isLong) continue;
    if (hardIdxs.has(i + 1)) continue;  // day before hard
    if (longIdxs.has(i - 1)) continue;  // day after long
    let score = 0;
    if (d.isQuality) score = 10;
    else if (d.type === 'easy') score = 5;
    else if (d.type === 'recovery') score = 3;
    else if (d.type === 'rest') score = 1;
    else continue;
    candidates.push({ date: d.date, type: d.type, score, isQuality: d.isQuality });
  }
  candidates.sort((a,b) => b.score - a.score);

  // Phase frequency cap
  const phLabel = weekDays[0]?.phaseLabel ?? '';
  let phaseCap = 2; // default
  const phUpper = phLabel.toUpperCase();
  if (phUpper === 'TAPER') phaseCap = 1;
  else if (phUpper === 'RACE-SPECIFIC') phaseCap = 1;
  else if (['QUALITY','BUILD','BASE'].includes(phUpper)) phaseCap = 2;

  const readinessCap = anyStreak ? 1 : 2;
  const acwrCap = (acwr != null && acwr > 1.5) ? 1 : 2;
  const target = Math.min(2, phaseCap, readinessCap, acwrCap, candidates.length);

  const label = wStart === monday ? ' ← CURRENT' : wStart > today ? '' : ' (past)';
  const candidateStr = candidates.slice(0,4).map(c => `${c.date}(${c.type[0]},s=${c.score})`).join(' ');
  const qualCandidates = candidates.filter(c => c.isQuality).length;

  console.log(`\nWeek ${wStart}${label}`);
  console.log(`  phase: ${phLabel || '?'}  phaseCap:${phaseCap}  readinessCap:${readinessCap}  acwrCap:${acwrCap}  → target:${target}`);
  console.log(`  plan days: ${weekDays.map(d => `${d.date}=${d.type[0]}${d.isQuality?'Q':''}${d.isLong?'L':''}`).join(' ')}`);
  console.log(`  candidates (${candidates.length}, ${qualCandidates} quality): ${candidateStr || '(none)'}`);
  console.log(`  → would pick: ${candidates.slice(0, target).map(c => c.date).join(', ') || '(none)'}`);
}

await pool.end();
console.log('\n=== done ===');
