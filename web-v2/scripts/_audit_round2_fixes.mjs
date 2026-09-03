// ─────────────────────────────────────────────────────────────────────────
// ROUND-2 LIVE FIX RE-VERIFICATION + FAITHFULNESS PROBE.
//
// Re-verifies the 6 round-1 fixes (a)-(f) END-TO-END on prod with the EXACT
// setups named in the round-2 brief, reading the PERSISTED plan_workouts
// (the post-mutation rows the runner actually gets). Then a FAITHFULNESS
// probe: 4 runner setups run through the LIVE API, the same ComposePlanInput
// reconstructed, and the derived inputs (recentWeeklyMi / recentLongMi /
// easyDayMedianMi) the offline harnesses FEED are compared to what
// loadGeneratorInputs REALLY produces for a cold-start runner.
//
// Serial (one shared test user). RO reads; RW only to reset the test user's
// own state between cases. NEVER touches a non-test user.
//
// Run from web-v2:  node scripts/_audit_round2_fixes.mjs
// ─────────────────────────────────────────────────────────────────────────
// PRODUCTION WRITE BARRIER · this file is verification tooling, so it is fenced.
// The fence refuses any database write unless DATABASE_URL is provably loopback,
// and stamps every outgoing request X-Faff-Verification so middleware.ts refuses
// a mutation that would reach production. See scripts/_verification-fence.mjs.
import './_verification-fence.mjs';
import pg from 'pg';
import fs from 'node:fs';

const BASE = 'https://www.faff.run';
const EMAIL = 'test-onboarding@faff.run';
const PASSWORD = 'Faff2026!';

function envVal(key) {
  const env = fs.readFileSync('.env.local', 'utf8');
  return env.split('\n').find((l) => l.startsWith(key + '='))?.slice(key.length + 1)?.trim() ?? '';
}
const RO = process.env.DATABASE_URL_RO || envVal('DATABASE_URL_RO') || envVal('DATABASE_URL');
const RW = process.env.DATABASE_URL || envVal('DATABASE_URL');
const dbro = new pg.Client({ connectionString: RO });
const dbrw = new pg.Client({ connectionString: RW });
await dbro.connect();
await dbrw.connect();

const iso = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const dow = (isoDate) => new Date(isoDate + 'T12:00:00Z').getUTCDay();

let TOKEN = '', USER_ID = '';
async function signIn() {
  const r = await fetch(`${BASE}/api/auth/email`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  TOKEN = (await r.json()).token;
  if (!TOKEN) throw new Error('sign-in failed');
  USER_ID = (await dbro.query(`SELECT id::text FROM users WHERE email=$1`, [EMAIL])).rows[0]?.id;
  if (!USER_ID) throw new Error('test user not found');
  // SAFETY: never run against a non-test user.
  if (EMAIL !== 'test-onboarding@faff.run') throw new Error('refusing: not the test user');
}
async function api(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json };
}
const post = (p, b) => api('POST', p, b);

async function reset() {
  await dbrw.query(`UPDATE training_plans SET archived_iso=NOW() WHERE user_uuid=$1 AND archived_iso IS NULL`, [USER_ID]).catch(() => {});
  await dbrw.query(`DELETE FROM races WHERE user_uuid=$1`, [USER_ID]).catch(() => {});
  await dbrw.query(
    `UPDATE profile SET user_settings = (user_settings - 'available_days'),
        goal_race_distance='none', goal_race_date=NULL, goal_race_time=NULL,
        tt_goal_distance=NULL, tt_goal_time=NULL, experience_level=NULL
      WHERE user_uuid=$1`, [USER_ID]).catch(() => {});
}
async function onboard(profile, extra = {}) {
  return post('/api/onboarding/complete', {
    distance: 'none', longRunDay: 'sun', name: 'Audit', timezone: 'America/Los_Angeles',
    raceHistory: [], connectionsSkipped: true, ...profile, ...extra,
  });
}
async function latestPlanId() {
  return (await dbro.query(
    `SELECT id FROM training_plans WHERE user_uuid=$1 AND archived_iso IS NULL ORDER BY authored_iso DESC LIMIT 1`,
    [USER_ID])).rows[0]?.id ?? null;
}
async function planRows(planId) {
  return (await dbro.query(
    `SELECT week_id, date_iso::text, dow, type, is_long, is_quality,
            distance_mi::float AS mi, pace_target_s_per_mi AS pace, workout_spec::text AS spec,
            sub_label
       FROM plan_workouts WHERE plan_id=$1 ORDER BY date_iso`, [planId])).rows;
}

const results = [];
function rec(label, ok, detail) {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  → ' + detail}`);
}

await signIn();
console.log(`\n===== ROUND-2 LIVE FIX RE-VERIFICATION · user ${USER_ID} =====\n`);

// ── FIX (a) · marathon no-plan dead-end. Marathon goal, plan_weeks 17,
//    start today+1d → a plan IS created + plan_error null. ───────────────────
console.log('── (a) marathon goal · plan_weeks 17 · start today+1d → plan created, plan_error null ──');
{
  await reset();
  await onboard({ experienceLevel: 'intermediate', weeklyFreq: 5, weeklyMi: 30, histAvg: '25-35', histLong: '10+' });
  const g = await post('/api/profile/goal', { distance_label: 'Marathon', goal_time: '3:30:00', plan_weeks: 17, start_date: iso(1) });
  const planId = g.json?.plan?.plan_id ?? null;
  // plan_error is a RESPONSE field from /api/profile/goal (not a profile column).
  const planErr = g.json?.plan_error ?? g.json?.plan?.error ?? null;
  const prof = (await dbro.query(`SELECT goal_race_distance FROM profile WHERE user_uuid=$1`, [USER_ID])).rows[0];
  const activeCount = Number((await dbro.query(`SELECT count(*) c FROM training_plans WHERE user_uuid=$1 AND archived_iso IS NULL`, [USER_ID])).rows[0].c);
  // The dead-end was: goal saved, 0 plans, no error. The fix guarantees a plan
  // IS created (after a Monday-anchored retry) and plan_error is null.
  const ok = !!planId && activeCount >= 1 && (planErr == null);
  rec('(a) marathon 17wk +1d generates a plan + plan_error null',
    ok, `planId=${planId} active=${activeCount} respErr=${JSON.stringify(planErr)} goal=${prof?.goal_race_distance} weeks=${g.json?.plan?.weeks}`);
}

// ── FIX (b) · race week respects available_days. Goal/race available_days=
//    [sat,sun] on a SUNDAY race → race week runs only on sat/sun. ────────────
console.log('\n── (b) available_days=[sat,sun], race on a Sunday → race week runs only sat/sun ──');
{
  await reset();
  // Race must be INSIDE the HM build window (<=14wk) so the plan is race-prep
  // with a real race WEEK (a race >14wk out → maintenance mode, no race week).
  // Snap to a Sunday ~12wk out.
  let raceDate = iso(84); // ~12wk
  for (let i = 0; i < 7; i++) { if (dow(raceDate) === 0) break; raceDate = iso(84 + i + 1); }
  await onboard({ experienceLevel: 'intermediate', weeklyFreq: 2, weeklyMi: 20, histAvg: '15-25', histLong: '6-10', longRunDay: 'sun' });
  // Use the RACE path · it takes an explicit date (the goal path only takes
  // plan_weeks → deadline = start + weeks, no arbitrary date). available_days
  // is patched to user_settings by /api/race before auto-gen.
  const g = await post('/api/race', { name: 'Audit Sun HM', date: raceDate, distance_label: 'Half Marathon', priority: 'A', goal: '2:00:00', start_date: iso(1), available_days: ['sat', 'sun'] });
  let planId = g.json?.plan?.plan_id ?? await latestPlanId();
  if (!planId) { rec('(b) race-week available-days', false, `no plan: ${JSON.stringify(g.json)}`); }
  else {
    const rows = await planRows(planId);
    // final week = the week containing the max date
    const maxDate = rows.reduce((m, r) => r.date_iso > m ? r.date_iso : m, '0000');
    const lastWeek = rows.find((r) => r.date_iso === maxDate)?.week_id;
    const lastWeekRun = rows.filter((r) => r.week_id === lastWeek && r.mi > 0 && !['strength', 'cross', 'xt', 'rest'].includes(r.type));
    const raceRow = rows.find((r) => r.type === 'race');
    // (1) RACE WEEK: every running day on sat(6)/sun(0); race day (Sunday) exempt.
    const lastWeekBad = lastWeekRun.filter((r) => ![0, 6].includes(r.dow) && r.type !== 'race');
    // (2) WHOLE PLAN: no running outside sat/sun (race day exempt) — the core
    //     available_days guarantee, end-to-end including the race week.
    const wholeBad = rows.filter((r) => r.mi > 0 && !['strength', 'cross', 'xt', 'rest', 'race'].includes(r.type) && ![0, 6].includes(r.dow));
    const isRacePrep = !!raceRow; // race-prep plan has a race row; maintenance won't
    const ok = lastWeekBad.length === 0 && wholeBad.length === 0 && isRacePrep && raceRow.dow === 0;
    rec('(b) race week + whole plan run only on sat/sun, race on Sunday', ok,
      `raceDate=${raceDate}(dow${dow(raceDate)}) weeks=${g.json?.plan?.weeks} racePrep=${isRacePrep} raceDow=${raceRow?.dow} lastWeekRunDows=[${lastWeekRun.map((r) => `${r.dow}:${r.type}`).join(',')}] lastWeekBad=${lastWeekBad.length} wholeBad=${wholeBad.map((r) => `${r.date_iso}dow${r.dow}`).slice(0, 4).join(',')}`);
  }
}

// ── FIX (c) · quality never exceeds the long / dwarfs the week. 5K, weeklyMi
//    55, available_days=[sat,sun] → no quality run exceeds the long. ─────────
console.log('\n── (c) overvolumed short-race + high-volume HM → no quality > long, no dwarf ──');
{
  // The brief's literal 5K·55mpw·weekends combo is CORRECTLY refused by the
  // 5K long-cap (10mi) validator (fail-safe, invariant 1 — surfaced as
  // plan_error, not a silent dead-end). We record that, then test the
  // quality<=long guarantee on setups that DO generate, where the dwarf/
  // inversion risk is real (over-volumed short race + high-volume HM).
  // (c0) document the over-volumed-5K fail-safe
  await reset();
  await onboard({ experienceLevel: 'advanced', weeklyFreq: 2, weeklyMi: 55, histAvg: '35+', histLong: '10+', longRunDay: 'sun' });
  const g0 = await post('/api/profile/goal', { distance_label: '5K', goal_time: '18:00', plan_weeks: 12, start_date: iso(1), available_days: ['sat', 'sun'] });
  const refusedWithError = !g0.json?.plan?.plan_id && (g0.json?.plan_error != null);
  rec('(c0) overvolumed 5K·55mpw correctly fail-safe (plan_error, not silent)', refusedWithError, `plan=${JSON.stringify(g0.json?.plan)} err=${JSON.stringify(g0.json?.plan_error)}`);

  // (c1) quality<=long across setups that DO generate (the quality<=long
  // guarantee can only be checked on an existing plan). The 5K case uses a
  // 5K-appropriate recent-long so the long stays under the 10mi 5K cap.
  const cases = [
    { lbl: '5K·30mpw·weekends·shortLong', prof: { experienceLevel: 'advanced', weeklyFreq: 2, weeklyMi: 30, histAvg: '25-35', histLong: '6-10', longRunDay: 'sun' }, goal: '5K', time: '18:00', avail: ['sat', 'sun'] },
    { lbl: '5K·20mpw·3day', prof: { experienceLevel: 'advanced', weeklyFreq: 3, weeklyMi: 20, histAvg: '15-25', histLong: '6-10', longRunDay: 'sun' }, goal: '5K', time: '19:00' },
    { lbl: '10K·45mpw·weekends', prof: { experienceLevel: 'advanced', weeklyFreq: 2, weeklyMi: 45, histAvg: '35+', histLong: '10+', longRunDay: 'sun' }, goal: '10K', time: '40:00', avail: ['sat', 'sun'] },
    { lbl: '10K·25mpw·4day', prof: { experienceLevel: 'intermediate', weeklyFreq: 4, weeklyMi: 25, histAvg: '15-25', histLong: '6-10', longRunDay: 'sun' }, goal: '10K', time: '50:00' },
    { lbl: 'HM·55mpw·5day', prof: { experienceLevel: 'advanced', weeklyFreq: 5, weeklyMi: 55, histAvg: '35+', histLong: '10+', longRunDay: 'sun' }, goal: 'Half Marathon', time: '1:25:00' },
  ];
  const dwarfViol = []; // INV4 — the part fix (c) FULLY guarantees
  const invertViol = []; // INV3 quality>long on the PERSISTED distance_mi
  let generated = 0;
  for (const c of cases) {
    await reset();
    await onboard(c.prof);
    const body = { distance_label: c.goal, goal_time: c.time, plan_weeks: 12, start_date: iso(1) };
    if (c.avail) body.available_days = c.avail;
    const g = await post('/api/profile/goal', body);
    const planId = g.json?.plan?.plan_id ?? await latestPlanId();
    if (!planId) { invertViol.push(`${c.lbl}: NO PLAN (${JSON.stringify(g.json?.plan_error)})`); continue; }
    generated++;
    const rows = await planRows(planId);
    const byWeek = {};
    for (const r of rows) (byWeek[r.week_id] ??= []).push(r);
    for (const drows of Object.values(byWeek)) {
      const longMi = Math.max(0, ...drows.filter((r) => r.is_long && r.type !== 'race').map((r) => r.mi));
      const wkMi = drows.reduce((s, r) => s + (r.mi || 0), 0);
      if (longMi <= 0) continue;
      for (const r of drows) {
        if (!r.is_quality || r.type === 'race') continue;
        if (r.mi > longMi + 0.05) invertViol.push(`${c.lbl} wk:${r.date_iso} ${r.type} ${r.mi} > long ${longMi} (Δ+${(r.mi - longMi).toFixed(1)})`);
        const ceil = Math.max(longMi * 1.5, wkMi * 0.6);
        if (r.mi > ceil + 0.1) dwarfViol.push(`${c.lbl} wk:${r.date_iso} quality ${r.mi} dwarfs (long ${longMi} wk ${wkMi.toFixed(1)})`);
      }
    }
  }
  // INV4 (no dwarf) is fully guaranteed by fix (c) → must be clean.
  rec(`(c) no quality DWARFS week/long (${generated}/3 generated)`, dwarfViol.length === 0, dwarfViol.slice(0, 6).join(' | '));
  // INV3 (quality NOT exceeding long) on the PERSISTED distance: this surfaces
  // the residual gap — persistPlan re-derives quality distance_mi from the spec
  // total (WU+core+CD via totalDistanceMiFromSpec, generate.ts:2034) AFTER the
  // easy/quality≤long sweep (generate.ts:2307-2325) caps only the headline
  // d.distanceMi. A short-5K long (~6mi) + a 3×1mi interval spec-total (~6.2mi)
  // ends up 0.2mi over the long in the persisted plan.
  rec(`(c-residual) PERSISTED quality<=long holds on the spec-total distance`, invertViol.length === 0,
    `RESIDUAL GAP in fix (c): ${invertViol.slice(0, 6).join(' | ')}`);
}

// ── FIX (d) · race-week frequency cap reaches 1-2 days. freq 1 → race only,
//    freq 2 → race+shakeout. ────────────────────────────────────────────────
console.log('\n── (d) freq 1 → race-week running-day count, freq 2 → race+shakeout ──');
for (const freq of [1, 2]) {
  await reset();
  await onboard({ experienceLevel: 'intermediate', weeklyFreq: freq, weeklyMi: 20, histAvg: '15-25', histLong: '6-10', longRunDay: 'sun' });
  const g = await post('/api/profile/goal', { distance_label: '10K', goal_time: '50:00', plan_weeks: 12, start_date: iso(1) });
  const planId = g.json?.plan?.plan_id ?? await latestPlanId();
  if (!planId) { rec(`(d) freq=${freq} race-week cap`, false, `no plan`); continue; }
  const rows = await planRows(planId);
  const maxDate = rows.reduce((m, r) => r.date_iso > m ? r.date_iso : m, '0000');
  const lastWeek = rows.find((r) => r.date_iso === maxDate)?.week_id;
  const lastRun = rows.filter((r) => r.week_id === lastWeek && r.mi > 0 && !['strength', 'cross', 'xt', 'rest'].includes(r.type));
  const types = lastRun.map((r) => r.type).sort();
  // freq 1 → exactly 1 running day (the race). freq 2 → exactly 2 (race + shakeout).
  const expected = freq; // race-week running-day count should match the cap for 1-2
  const ok = lastRun.length === expected && types.includes('race');
  rec(`(d) freq=${freq} → race-week running-days=${lastRun.length} (expected ${expected})`, ok,
    `types=[${types.join(',')}]`);
}

// ── FIX (e) · re-onboarding advanced→beginner flips + beginner 5K has NO
//    interval rows. ──────────────────────────────────────────────────────────
console.log('\n── (e) re-onboard advanced→beginner flips experience_level + beginner 5K has no interval rows ──');
{
  await reset();
  await onboard({ experienceLevel: 'advanced', weeklyFreq: 5, weeklyMi: 35, histAvg: '35+', histLong: '10+' });
  const e1 = (await dbro.query(`SELECT experience_level e FROM profile WHERE user_uuid=$1`, [USER_ID])).rows[0]?.e;
  // re-onboard as beginner WITHOUT nulling (the COALESCE-trap scenario)
  await onboard({ experienceLevel: 'beginner', weeklyFreq: 4, weeklyMi: 15, histAvg: '5-15', histLong: '3-6' });
  const e2 = (await dbro.query(`SELECT experience_level e FROM profile WHERE user_uuid=$1`, [USER_ID])).rows[0]?.e;
  const g = await post('/api/profile/goal', { distance_label: '5K', goal_time: '30:00', plan_weeks: 12, start_date: iso(1) });
  const planId = g.json?.plan?.plan_id ?? await latestPlanId();
  let intervalRows = [];
  if (planId) {
    const rows = await planRows(planId);
    const vo2 = /@\s*I\b|@\s*R\b|\bI-pace|\bR-pace|\bVO2/i;
    intervalRows = rows.filter((r) => r.is_quality && r.type !== 'race_week_tuneup' && r.type !== 'shakeout'
      && (r.type === 'intervals' || r.type === 'repetition' || vo2.test(`${r.sub_label ?? ''} ${r.spec ?? ''}`)));
  }
  const ok = e1 === 'advanced' && e2 === 'beginner' && intervalRows.length === 0;
  rec('(e) advanced→beginner flips + beginner 5K no I/R intervals', ok,
    `e1=${e1} e2=${e2} intervalRows=${intervalRows.length} (${intervalRows.slice(0, 3).map((r) => `${r.type}:${r.sub_label}`).join(' | ')})`);
}

// ── FIX (f) · no 0-mile labeled running day. Sweep a few setups, assert no
//    plan_workouts row has distance_mi=0 with a running type. ────────────────
console.log('\n── (f) no plan_workouts row has distance_mi=0 with a running type ──');
{
  const zeroFails = [];
  const cases = [
    { lbl: 'beginner·5K·0mi·3day', prof: { experienceLevel: 'beginner', weeklyFreq: 3, weeklyMi: 0, histAvg: '0-5', histLong: '0-3' }, goal: '5K', time: '32:00' },
    { lbl: 'beginner·HM·5mi·3day', prof: { experienceLevel: 'beginner', weeklyFreq: 3, weeklyMi: 5, histAvg: '0-5', histLong: '0-3' }, goal: 'Half Marathon', time: '2:30:00' },
    { lbl: 'int·M·15mi·4day', prof: { experienceLevel: 'intermediate', weeklyFreq: 4, weeklyMi: 15, histAvg: '15-25', histLong: '6-10' }, goal: 'Marathon', time: '4:30:00' },
    { lbl: '1day·Marathon·5mi', prof: { experienceLevel: 'beginner', weeklyFreq: 1, weeklyMi: 5, histAvg: '0-5', histLong: '0-3' }, goal: 'Marathon', time: '5:00:00' },
  ];
  let generated = 0;
  const deadEnds = []; // generated NO plan AND surfaced no error → invariant-1 violation
  for (const c of cases) {
    await reset();
    await onboard(c.prof);
    const g = await post('/api/profile/goal', { distance_label: c.goal, goal_time: c.time, plan_weeks: 14, start_date: iso(1) });
    const planId = g.json?.plan?.plan_id ?? await latestPlanId();
    if (!planId) {
      // Acceptable ONLY if an explicit error was surfaced (fail-safe, invariant 1).
      // A silent null with no error IS a dead-end finding.
      if (g.json?.plan_error == null) deadEnds.push(`${c.lbl}: NO PLAN + NO ERROR (silent dead-end)`);
      continue;
    }
    generated++;
    const rows = await planRows(planId);
    const RUN = ['easy', 'long', 'threshold', 'intervals', 'tempo', 'race', 'recovery', 'shakeout', 'race_week_tuneup'];
    const zeros = rows.filter((r) => RUN.includes(r.type) && (r.mi == null || r.mi <= 0));
    if (zeros.length) zeroFails.push(`${c.lbl}: ${zeros.length} zero-mi running rows (${zeros.slice(0, 3).map((r) => `${r.date_iso} ${r.type}=${r.mi}`).join(', ')})`);
  }
  rec(`(f) no 0-mile labeled running day (${generated}/4 generated, rest fail-safe with error)`, zeroFails.length === 0 && deadEnds.length === 0, [...zeroFails, ...deadEnds].join(' | '));
}

// ════════════════════════════════════════════════════════════════════════════
// FINDING-X · high-volume 5K runner gets NO plan (5K long-cap dead-end).
// A ≥25-30mpw runner targeting a 5K produces a 12mi long (long sizing follows
// weekly volume / recent-long), which the 5K doctrine cap (10mi) rejects in
// validateComposedPlan. Fail-safe (plan_error surfaced, invariant 1 HOLDS — no
// silent dead-end), but the runner gets zero plan. There is no author-time
// clamp of the long to longRunCapMi (the WoW smoother caps GROWTH, not the
// absolute). Documented as a finding, not a fix-regression. Probe records the
// exact repro + confirms it is fail-safe (error present), not a crash.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n── FINDING-X · high-volume 5K → long-cap dead-end (fail-safe?) ──');
{
  await reset();
  await onboard({ experienceLevel: 'advanced', weeklyFreq: 3, weeklyMi: 35, histAvg: '35+', histLong: '10+', longRunDay: 'sun' });
  const g = await post('/api/profile/goal', { distance_label: '5K', goal_time: '18:00', plan_weeks: 12, start_date: iso(1) });
  const planId = g.json?.plan?.plan_id ?? null;
  const err = g.json?.plan_error ?? null;
  const activeCount = Number((await dbro.query(`SELECT count(*) c FROM training_plans WHERE user_uuid=$1 AND archived_iso IS NULL`, [USER_ID])).rows[0].c);
  const noPlan = !planId && activeCount === 0;
  const failSafe = noPlan && err != null && /exceeds .* limit for 5K/i.test(err);
  // The INVARIANT under test is fail-safe (invariant 1): no plan is acceptable
  // ONLY if an explicit error is surfaced. That holds → PASS. The *finding*
  // (high-vol 5K runner can't get a plan) is recorded in the detail for triage.
  rec('FINDING-X · high-vol 5K no-plan is FAIL-SAFE (error surfaced, not silent)', failSafe || !!planId,
    `planId=${planId} active=${activeCount} err=${JSON.stringify(err)} → FINDING: a ≥35mpw 5K runner gets zero plan (long 12mi > 10mi 5K cap; no author-time long clamp to doctrine cap)`);
}

// ════════════════════════════════════════════════════════════════════════════
// FAITHFULNESS PROBE · 4 setups: run LIVE, capture what loadGeneratorInputs
// REALLY derived (via the persisted plan's authoredState recent_avg_mpw), and
// compare with the offline harness's derived-input formulas.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n── FAITHFULNESS · offline derived-input formulas vs real loadGeneratorInputs ──');
const faith = [];
const faithCases = [
  { lbl: 'cold·intermediate·HM·25mi', prof: { experienceLevel: 'intermediate', weeklyFreq: 5, weeklyMi: 25, histAvg: '15-25', histLong: '6-10' }, goal: 'Half Marathon', time: '2:00:00', selfAvg: 20, selfLong: 8 },
  { lbl: 'cold·advanced·M·45mi', prof: { experienceLevel: 'advanced', weeklyFreq: 6, weeklyMi: 45, histAvg: '35+', histLong: '10+' }, goal: 'Marathon', time: '3:00:00', selfAvg: 35, selfLong: 12 },
  { lbl: 'cold·beginner·5K·15mi', prof: { experienceLevel: 'beginner', weeklyFreq: 3, weeklyMi: 15, histAvg: '5-15', histLong: '3-6' }, goal: '5K', time: '28:00', selfAvg: 10, selfLong: 5 },
  { lbl: 'cold·intermediate·10K·35mi', prof: { experienceLevel: 'intermediate', weeklyFreq: 5, weeklyMi: 35, histAvg: '25-35', histLong: '10+' }, goal: '10K', time: '50:00', selfAvg: 30, selfLong: 10 },
];
for (const c of faithCases) {
  await reset();
  const onb = await onboard(c.prof);
  // capture what onboarding persisted to history_* (the cold-start self-report seed)
  const histRow = (await dbro.query(
    `SELECT history_avg_weekly_mi avg, weekly_mileage_target tgt, history_longest_recent_mi lng
       FROM profile WHERE user_uuid=$1`, [USER_ID])).rows[0];
  const g = await post('/api/profile/goal', { distance_label: c.goal, goal_time: c.time, plan_weeks: 14, start_date: iso(1) });
  const planId = g.json?.plan?.plan_id ?? await latestPlanId();
  if (!planId) { faith.push({ ...c, error: 'no plan' }); continue; }
  const state = (await dbro.query(`SELECT authored_state s FROM training_plans WHERE id=$1`, [planId])).rows[0]?.s ?? {};
  const rows = await planRows(planId);
  // empirical: peak training week + that week's long + the median easy distance
  const byWeek = {};
  for (const r of rows) (byWeek[r.week_id] ??= []).push(r);
  let peakTrain = 0, peakLong = 0;
  const easyDists = [];
  for (const drows of Object.values(byWeek)) {
    const trainMi = drows.filter((r) => r.type !== 'race').reduce((s, r) => s + (r.mi || 0), 0);
    if (trainMi > peakTrain) { peakTrain = trainMi; peakLong = Math.max(0, ...drows.filter((r) => r.is_long && r.type !== 'race').map((r) => r.mi)); }
    for (const r of drows) if (r.type === 'easy' && r.mi > 0) easyDists.push(r.mi);
  }
  easyDists.sort((a, b) => a - b);
  const medianEasy = easyDists.length ? easyDists[Math.floor(easyDists.length / 2)] : 0;
  // What the offline harnesses FEED for the same stated weekly mileage:
  const offRecentLong = Math.round(c.prof.weeklyMi * 0.25);
  const offEasyMedian = Math.max(3, Math.round(c.prof.weeklyMi / 5));
  faith.push({
    lbl: c.lbl, statedWeeklyMi: c.prof.weeklyMi,
    real: {
      recent_avg_mpw: state.recent_avg_mpw ?? null, // what loadGeneratorInputs put in
      historySeed: { avg: Number(histRow?.avg ?? 0), tgt: Number(histRow?.tgt ?? 0), long: Number(histRow?.lng ?? 0) },
      planPeakTrain: Math.round(peakTrain), planPeakLong: peakLong, planMedianEasy: medianEasy,
    },
    offlineFeeds: { recentWeeklyMi: c.prof.weeklyMi, recentLongMi: offRecentLong, easyDayMedianMi: offEasyMedian },
  });
}
console.log(JSON.stringify(faith, null, 2));

await reset();
await dbrw.query(`UPDATE profile SET experience_level=NULL WHERE user_uuid=$1`, [USER_ID]).catch(() => {});

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);
console.log(`\n========== FIXES: ${passed}/${results.length} PASS ==========`);
if (failed.length) for (const r of failed) console.log(`  ✗ ${r.label}: ${r.detail}`);

fs.writeFileSync('/tmp/_round2_fixes.json', JSON.stringify({ passed, total: results.length, results, faith }, null, 2));

await dbro.end();
await dbrw.end();
process.exit(failed.length ? 1 : 0);
