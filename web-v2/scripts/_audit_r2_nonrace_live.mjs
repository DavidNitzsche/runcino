// ─────────────────────────────────────────────────────────────────────────
// ROUND-2 COMPLETENESS-CHECKER · LIVE maintenance + recovery (the auditor's
// biggest acknowledged gap: both composers were swept OFFLINE only).
//
// Drives the REAL generatePlan DB path on prod for:
//   (M) maintenance — a far-out race (> BUILD_WINDOW_WEEKS) → 4-wk hold block.
//   (R) recovery — a just-FINISHED A/B race + a future race → light block.
// Then reads PERSISTED plan_workouts and re-checks the invariants the offline
// sweep could not see post-persist: spec-inflation of quality (does maintenance
// threshold/fartlek persist a distance > the maintenance long?), 7-clean-days,
// no-0-mile, freq cap, available_days (which the composers structurally IGNORE).
//
// Serial · RO reads + RW only on the test user · NEVER a non-test user.
// Run from web-v2:  node scripts/_audit_r2_nonrace_live.mjs
// ─────────────────────────────────────────────────────────────────────────
import pg from 'pg';
import fs from 'node:fs';

const BASE = 'https://www.faff.run';
const EMAIL = 'test-onboarding@faff.run';
const PASSWORD = 'Faff2026!';
const PROTECTED = new Set([
  '0645f40c-951d-4ccc-b86e-9979cd26c795', // David
  '2314bf7b-eb9e-4538-af8e-a12413d9e7b7', // Lilley
]);

const envVal = (k) => { const e = fs.readFileSync('.env.local', 'utf8'); return e.split('\n').find((l) => l.startsWith(k + '='))?.slice(k.length + 1)?.trim() ?? ''; };
const dbro = new pg.Client({ connectionString: envVal('DATABASE_URL_RO') });
const dbrw = new pg.Client({ connectionString: envVal('DATABASE_URL') });
await dbro.connect(); await dbrw.connect();

const iso = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const dow = (d) => new Date(d + 'T12:00:00Z').getUTCDay();

let TOKEN = '', USER_ID = '';
async function signIn() {
  const r = await fetch(`${BASE}/api/auth/email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  TOKEN = (await r.json()).token;
  USER_ID = (await dbro.query(`SELECT id::text FROM users WHERE email=$1`, [EMAIL])).rows[0]?.id;
  if (!TOKEN || !USER_ID) throw new Error('sign-in failed');
  if (EMAIL !== 'test-onboarding@faff.run' || PROTECTED.has(USER_ID)) throw new Error('refusing: not the safe test user');
}
const post = async (p, b) => { const r = await fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})) }; };

async function reset() {
  if (PROTECTED.has(USER_ID)) throw new Error('GUARD');
  await dbrw.query(`UPDATE training_plans SET archived_iso=NOW() WHERE user_uuid=$1 AND archived_iso IS NULL`, [USER_ID]).catch(() => {});
  await dbrw.query(`DELETE FROM races WHERE user_uuid=$1`, [USER_ID]).catch(() => {});
  await dbrw.query(`UPDATE profile SET user_settings=(user_settings - 'available_days'), goal_race_distance='none', goal_race_date=NULL, goal_race_time=NULL, tt_goal_distance=NULL, tt_goal_time=NULL, experience_level=NULL WHERE user_uuid=$1`, [USER_ID]).catch(() => {});
}
async function onboard(profile, extra = {}) {
  return post('/api/onboarding/complete', { distance: 'none', longRunDay: 'sun', name: 'Audit', timezone: 'America/Los_Angeles', raceHistory: [], connectionsSkipped: true, ...profile, ...extra });
}
async function latestPlan() {
  return (await dbro.query(`SELECT id, authored_state::text AS st FROM training_plans WHERE user_uuid=$1 AND archived_iso IS NULL ORDER BY authored_iso DESC LIMIT 1`, [USER_ID])).rows[0] ?? null;
}
async function rows(planId) {
  return (await dbro.query(`SELECT week_id, date_iso::text AS d, dow, type, is_long, is_quality, distance_mi::float AS mi, pace_target_s_per_mi AS pace, workout_spec::text AS spec, sub_label AS sub FROM plan_workouts WHERE plan_id=$1 ORDER BY date_iso`, [planId])).rows;
}

const out = [];
const rec = (lbl, ok, detail) => { out.push({ lbl, ok, detail }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${lbl}${ok ? '' : '  → ' + detail}`); };

// generic invariant re-check on persisted rows. mode='maintenance'|'recovery'.
function checkInvariants(tag, rs, { availSet = null, freqCap = null, mode }) {
  const byWeek = new Map();
  for (const r of rs) { if (!byWeek.has(r.week_id)) byWeek.set(r.week_id, []); byWeek.get(r.week_id).push(r); }
  const RUN = (t) => !['rest', 'strength', 'cross', 'xt'].includes(t);
  const viol = { inv2_days: [], inv3_qLong: [], inv3_eLong: [], inv7_qpace: [], inv8_avail: [], inv9_freq: [], inv13_zero: [], inv_quality_present: [] };
  for (const [, wk] of byWeek) {
    // INV2 — exactly 7 contiguous days, one PRIMARY (running/rest) workout/day.
    // strength/cross are SECONDARY rows that legitimately share a date with a run.
    const dates = [...new Set(wk.map((r) => r.d))].sort();
    if (dates.length !== 7) viol.inv2_days.push(`${dates[0]}:days=${dates.length}`);
    const perDay = new Map();
    for (const r of wk) { if (['strength', 'cross', 'xt'].includes(r.type)) continue; perDay.set(r.d, (perDay.get(r.d) || 0) + 1); }
    for (const [d, c] of perDay) if (c > 1) viol.inv2_days.push(`${d}:primaryDup=${c}`);
    // contiguity
    for (let k = 1; k < dates.length; k++) { const gap = (new Date(dates[k]) - new Date(dates[k - 1])) / 86400000; if (gap !== 1) viol.inv2_days.push(`gap ${dates[k - 1]}→${dates[k]}=${gap}d`); }

    const runs = wk.filter((r) => RUN(r.type) && r.mi > 0);
    const longMi = Math.max(0, ...wk.filter((r) => r.is_long).map((r) => r.mi));
    for (const r of runs) {
      // INV13 — no NaN/null/neg/0 on a labeled running day
      if (r.mi == null || Number.isNaN(r.mi) || r.mi <= 0) viol.inv13_zero.push(`${r.d}:${r.type}:${r.mi}`);
      // INV3 — long is the longest run (race exempt; none in maint/recov)
      if (longMi > 0 && r.type !== 'long' && r.type !== 'race') {
        if (r.is_quality && r.mi > longMi) viol.inv3_qLong.push(`${r.d}:${r.type} ${r.mi}>long${longMi}`);
        if (r.type === 'easy' && r.mi > longMi) viol.inv3_eLong.push(`${r.d}:easy ${r.mi}>long${longMi}`);
      }
      // INV7 — every quality row has a pace target AND a spec
      if (r.is_quality && (r.pace == null || r.spec == null)) viol.inv7_qpace.push(`${r.d}:${r.type} pace=${r.pace} spec=${r.spec == null ? 'null' : 'ok'}`);
      // INV8 — running days ⊆ available
      if (availSet && !availSet.has(r.dow) && r.type !== 'race') viol.inv8_avail.push(`${r.d}:dow${r.dow}:${r.type}`);
    }
    // INV9 — frequency cap
    if (freqCap != null && runs.length > freqCap) viol.inv9_freq.push(`${dates[0]}:runDays=${runs.length}>cap${freqCap}`);
    // RECOVERY must have ZERO quality rows
    if (mode === 'recovery' && wk.some((r) => r.is_quality)) viol.inv_quality_present.push(`${dates[0]}:has-quality`);
  }
  return viol;
}

await signIn();
console.log(`\n===== ROUND-2 LIVE NON-RACE (maintenance + recovery) · user ${USER_ID} =====\n`);

// ── (M) MAINTENANCE · far-out race → 4-week hold. Sweep tiers + freq + avail. ──
console.log('── (M) MAINTENANCE · race beyond build window → persisted hold block ──');
const maintCases = [
  { lbl: 'M·intermediate·HM·25mi·5day·20wk', prof: { experienceLevel: 'intermediate', weeklyFreq: 5, weeklyMi: 25, histAvg: '15-25', histLong: '6-10', longRunDay: 'sun' }, dist: 'Half Marathon', weeksOut: 20, freq: 5 },
  { lbl: 'M·advanced·M·45mi·6day·26wk', prof: { experienceLevel: 'advanced', weeklyFreq: 6, weeklyMi: 45, histAvg: '35+', histLong: '10+', longRunDay: 'sun' }, dist: 'Marathon', weeksOut: 26, freq: 6 },
  { lbl: 'M·intermediate·M·30mi·3day·24wk·avail[sat,sun,wed]', prof: { experienceLevel: 'intermediate', weeklyFreq: 3, weeklyMi: 30, histAvg: '25-35', histLong: '10+', longRunDay: 'sun' }, dist: 'Marathon', weeksOut: 24, freq: 3, avail: ['sat', 'sun', 'wed'] },
  { lbl: 'M·advanced·5K·40mi·6day·16wk', prof: { experienceLevel: 'advanced', weeklyFreq: 6, weeklyMi: 40, histAvg: '35+', histLong: '10+', longRunDay: 'sun' }, dist: '5K', weeksOut: 16, freq: 6 },
];
for (const c of maintCases) {
  await reset();
  await onboard(c.prof);
  // far-out race via /api/race (date beyond build window forces maintenance mode)
  let rd = iso(c.weeksOut * 7);
  const body = { name: c.lbl, date: rd, distance_label: c.dist, priority: 'A', goal: null, start_date: iso(1) };
  if (c.avail) body.available_days = c.avail;
  const g = await post('/api/race', body);
  const pl = await latestPlan();
  if (!pl) { rec(c.lbl + ' · generates', false, `no plan: ${JSON.stringify(g.json).slice(0, 200)}`); continue; }
  const st = JSON.parse(pl.st || '{}');
  const rs = await rows(pl.id);
  const isMaint = st.mode === 'maintenance';
  rec(c.lbl + ' · is maintenance mode', isMaint, `mode=${st.mode} weeks=${[...new Set(rs.map(r => r.week_id))].length}`);
  const availSet = c.avail ? new Set(c.avail.map((a) => ({ sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }[a]))) : null;
  const v = checkInvariants(c.lbl, rs, { availSet, freqCap: c.freq, mode: 'maintenance' });
  rec(c.lbl + ' · INV2 7-clean-days', v.inv2_days.length === 0, v.inv2_days.slice(0, 4).join(' | '));
  rec(c.lbl + ' · INV3 quality≤long (PERSISTED spec-total)', v.inv3_qLong.length === 0, v.inv3_qLong.slice(0, 6).join(' | '));
  rec(c.lbl + ' · INV3 easy≤long (PERSISTED)', v.inv3_eLong.length === 0, v.inv3_eLong.slice(0, 6).join(' | '));
  rec(c.lbl + ' · INV7 quality has pace+spec', v.inv7_qpace.length === 0, v.inv7_qpace.slice(0, 4).join(' | '));
  rec(c.lbl + ' · INV8 available_days (composer is avail-BLIND — expect fail if avail set)', v.inv8_avail.length === 0, `OFF-AVAIL: ${v.inv8_avail.slice(0, 6).join(' | ')}`);
  rec(c.lbl + ' · INV9 freq cap', v.inv9_freq.length === 0, v.inv9_freq.slice(0, 4).join(' | '));
  rec(c.lbl + ' · INV13 no 0-mile run', v.inv13_zero.length === 0, v.inv13_zero.slice(0, 6).join(' | '));
}

// ── (R) RECOVERY · finished A/B race + future race → light block. ─────────────
console.log('\n── (R) RECOVERY · just-finished race + a future race → persisted light block ──');
const recovCases = [
  { lbl: 'R·post-M·advanced·50mi', prof: { experienceLevel: 'advanced', weeklyFreq: 6, weeklyMi: 50, histAvg: '35+', histLong: '10+', longRunDay: 'sun' }, finishedDist: 'Marathon', finishedAgo: 3, nextDist: 'Marathon', nextIn: 70 },
  { lbl: 'R·post-HM·intermediate·30mi', prof: { experienceLevel: 'intermediate', weeklyFreq: 5, weeklyMi: 30, histAvg: '25-35', histLong: '6-10', longRunDay: 'sun' }, finishedDist: 'Half Marathon', finishedAgo: 2, nextDist: 'Half Marathon', nextIn: 60 },
  { lbl: 'R·post-50K·advanced·60mi', prof: { experienceLevel: 'advanced', weeklyFreq: 6, weeklyMi: 60, histAvg: '35+', histLong: '10+', longRunDay: 'sun' }, finishedDist: '50K', finishedAgo: 4, nextDist: 'Marathon', nextIn: 80 },
];
for (const c of recovCases) {
  await reset();
  await onboard(c.prof);
  // 1) Create the (eventually-past) race via the app route so all NOT NULL
  //    columns are filled, THEN UPDATE its meta date into the past (RW, test
  //    user only) so loadLastRaceFinished sees a finished A/B race.
  const pastDate = iso(-c.finishedAgo);
  const finRes = await post('/api/race', { name: c.lbl + '-finished', date: iso(7), distance_label: c.finishedDist, priority: 'A', goal: null, start_date: iso(1) });
  const finSlug = finRes.json?.slug ?? finRes.json?.race?.slug ?? null;
  if (PROTECTED.has(USER_ID)) throw new Error('GUARD');
  // backdate the finished race's meta.date (jsonb field-level update, test user only)
  await dbrw.query(
    `UPDATE races SET meta = jsonb_set(meta, '{date}', to_jsonb($2::text))
       WHERE user_uuid=$1 AND slug=$3`,
    [USER_ID, pastDate, finSlug]
  ).catch((e) => console.log('   (backdate finished race err)', e.message, 'slug=', finSlug));
  // 2) a FUTURE race (the target the recovery block bridges toward) — its
  //    creation re-triggers generatePlan, which now sees the backdated finish.
  const g = await post('/api/race', { name: c.lbl + '-next', date: iso(c.nextIn), distance_label: c.nextDist, priority: 'A', goal: null, start_date: iso(1) });
  const pl = await latestPlan();
  if (!pl) { rec(c.lbl + ' · generates', false, `no plan: ${JSON.stringify(g.json).slice(0, 200)}`); continue; }
  const st = JSON.parse(pl.st || '{}');
  const rs = await rows(pl.id);
  const isRecov = st.mode === 'recovery';
  rec(c.lbl + ' · is recovery mode', isRecov, `mode=${st.mode} weeks=${[...new Set(rs.map(r => r.week_id))].length} (recovery only if past-race seen + within window)`);
  const v = checkInvariants(c.lbl, rs, { availSet: null, freqCap: c.prof.weeklyFreq, mode: isRecov ? 'recovery' : 'maintenance' });
  rec(c.lbl + ' · INV2 7-clean-days', v.inv2_days.length === 0, v.inv2_days.slice(0, 4).join(' | '));
  rec(c.lbl + ' · INV13 no 0-mile run', v.inv13_zero.length === 0, v.inv13_zero.slice(0, 6).join(' | '));
  rec(c.lbl + ' · INV3 easy≤long (PERSISTED)', v.inv3_eLong.length === 0, v.inv3_eLong.slice(0, 6).join(' | '));
  if (isRecov) rec(c.lbl + ' · INV(recov) zero quality rows', v.inv_quality_present.length === 0, v.inv_quality_present.slice(0, 4).join(' | '));
}

// clean up so the test user is left in a neutral state
await reset();
const pass = out.filter((o) => o.ok).length, fail = out.length - pass;
console.log(`\n========== NON-RACE LIVE: ${pass}/${out.length} PASS, ${fail} FAIL ==========`);
console.log(JSON.stringify(out.filter((o) => !o.ok), null, 1));
fs.writeFileSync('/tmp/_audit_r2_nonrace.json', JSON.stringify(out, null, 1));
await dbro.end(); await dbrw.end();
