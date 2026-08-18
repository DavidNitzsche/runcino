#!/usr/bin/env node
/**
 * ROUND-3 re-verification harness — reproduces all 12 fixes (a)-(l) on PROD.
 *
 * Strategy:
 *  - Drive the TRUE onboarding->plan path via POST /api/onboarding/complete
 *    (sets experienceLevel/weeklyMi/weeklyFreq + race distance/date, then
 *    calls generatePlan internally) OR /api/profile/goal (goalTarget path).
 *  - Drive maintenance/recovery via /api/race (create far-future / recent-past
 *    A-races) + /api/plan/generate.
 *  - After each generation, READ THE PERSISTED plan_workouts / plan_weeks rows
 *    from the RO DB and assert invariants ON THE PERSISTED ROWS (not the
 *    in-memory composer output).
 *
 * The test user (test-onboarding@faff.run, b8b75dd8...) has 0 runs, so
 * recentWeeklyMi is seeded from the self-reported weekly_mileage_target
 * (the `weeklyMi` chip). histAvg is sent null so `target` (not the histAvg
 * midpoint) is the seed -> exact 25/35/45/55.
 *
 * SERIAL only (shared test user). Never touches another user.
 */
import pg from 'pg';
import { readFileSync } from 'fs';

const BASE = 'https://www.faff.run';
const EMAIL = 'test-onboarding@faff.run';
const PASSWORD = 'Faff2026!';
const RO_URL = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  .match(/^DATABASE_URL_RO=(.+)$/m)[1].replace(/^["']|["']$/g, '');

let TOKEN = null;
let UID = null;
const db = new pg.Client({ connectionString: RO_URL, ssl: { rejectUnauthorized: false } });

// ── helpers ───────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function isoPlusDays(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}
async function api(path, body, method = 'POST') {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* */ }
  return { status: res.status, json };
}
async function signIn() {
  const res = await fetch(BASE + '/api/auth/email', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const j = await res.json();
  TOKEN = j.token; UID = j.user_uuid;
  if (!TOKEN) throw new Error('sign-in failed: ' + JSON.stringify(j));
}

/** Read the freshest ACTIVE plan's persisted rows. */
async function readActivePlan() {
  const p = (await db.query(
    `SELECT id, mode, race_id, authored_state FROM training_plans
      WHERE user_uuid=$1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`, [UID])).rows[0];
  if (!p) return null;
  const weeks = (await db.query(
    `SELECT id, week_idx, week_start_iso, is_race_week, is_peak, is_cutback
       FROM plan_weeks WHERE plan_id=$1 ORDER BY week_idx`, [p.id])).rows;
  const workouts = (await db.query(
    `SELECT week_id, date_iso, dow, type, distance_mi::float AS distance_mi,
            pace_target_s_per_mi, is_quality, is_long, sub_label, workout_spec
       FROM plan_workouts WHERE plan_id=$1 ORDER BY date_iso, dow`, [p.id])).rows;
  return { plan: p, weeks, workouts };
}

/** Count active plans (concurrency check). */
async function countActivePlans() {
  return Number((await db.query(
    `SELECT count(*)::int n FROM training_plans WHERE user_uuid=$1 AND archived_iso IS NULL`,
    [UID])).rows[0].n);
}

/** Wipe ALL plans + races for the test user via the ADMIN? No — RO only.
 *  Instead we rely on generate's clearActivePlans (archives prior). We delete
 *  test races only through the API DELETE to keep state clean between modes. */
async function deleteAllRaces() {
  const races = (await db.query(`SELECT slug FROM races WHERE user_uuid=$1`, [UID])).rows;
  for (const r of races) {
    await api('/api/race', { slug: r.slug }, 'DELETE');
  }
}

// ── invariant checks on PERSISTED rows ──────────────────────────────────────
/**
 * Returns array of violation strings. Groups workouts by week_id, finds the
 * long per week (the max-distance is_long row, race exempt handled by caller),
 * asserts:
 *   - quality.distance_mi <= long.distance_mi  (fix g / inv 3)
 *   - easy.distance_mi    <= long.distance_mi
 *   - every quality row has a pace + spec      (inv 7)
 *   - 7 contiguous days per week               (inv 2)
 *   - no 0-mile non-rest/non-race running day  (fix f / inv 13)
 */
function checkPersisted(plan, opts = {}) {
  const v = [];
  const { weeks, workouts } = plan;
  const byWeek = new Map();
  for (const w of workouts) {
    if (!byWeek.has(w.week_id)) byWeek.set(w.week_id, []);
    byWeek.get(w.week_id).push(w);
  }
  for (const wk of weeks) {
    const rows = byWeek.get(wk.id) || [];
    // longest run of the week INCLUDING race day (short-race race week: race is longest)
    const longMi = Math.max(0, ...rows.filter((r) => r.is_long).map((r) => r.distance_mi));
    // also consider type==='race' rows as the long for race week (race day isLong=true already)
    for (const r of rows) {
      // (g) / inv 3: persisted quality distance must be <= week's long
      if (r.is_quality && r.type !== 'race' && longMi > 0 && r.distance_mi > longMi + 0.001) {
        v.push(`QUALITY>LONG wk${wk.week_idx} ${wk.week_start_iso}: ${r.type} ${r.sub_label} ${r.distance_mi}mi > long ${longMi}mi`);
      }
      // easy <= long
      if (r.type === 'easy' && longMi > 0 && r.distance_mi > longMi + 0.001) {
        v.push(`EASY>LONG wk${wk.week_idx} ${wk.week_start_iso}: easy ${r.distance_mi}mi > long ${longMi}mi`);
      }
      // inv 7: quality rows carry pace + spec
      if (r.is_quality && r.type !== 'race') {
        if (r.pace_target_s_per_mi == null) v.push(`NO_PACE wk${wk.week_idx}: ${r.type} ${r.sub_label}`);
        if (r.workout_spec == null) v.push(`NO_SPEC wk${wk.week_idx}: ${r.type} ${r.sub_label}`);
      }
      // inv 13 / (f): no non-positive labeled running day
      const RUN_TYPES = new Set(['easy', 'long', 'tempo', 'threshold', 'intervals', 'vo2max', 'recovery', 'race', 'race_week_tuneup', 'shakeout']);
      if (RUN_TYPES.has(r.type) && !(r.distance_mi > 0)) {
        v.push(`ZERO_MILE_RUN wk${wk.week_idx} ${r.date_iso}: ${r.type} ${r.distance_mi}mi`);
      }
    }
  }
  return v;
}

/** Verify 7 contiguous days per persisted week (inv 2). Counts DISTINCT dates
 *  per week incl. rest rows; expects exactly 7 spanning a contiguous range. */
function check7Days(plan) {
  const v = [];
  const byWeek = new Map();
  for (const w of plan.workouts) {
    if (!byWeek.has(w.week_id)) byWeek.set(w.week_id, new Set());
    byWeek.get(w.week_id).add(w.date_iso);
  }
  for (const wk of plan.weeks) {
    const dates = [...(byWeek.get(wk.id) || [])].sort();
    if (dates.length === 0) continue; // empty week row (shouldn't persist workouts)
    const span = (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86400000 + 1;
    if (dates.length !== 7 || span !== 7) {
      v.push(`WEEK_NOT_7 wk${wk.week_idx} ${wk.week_start_iso}: ${dates.length} distinct dates span ${span}d (${dates[0]}..${dates[dates.length-1]})`);
    }
  }
  return v;
}

/** available_days respected: every running day's dow in the allowed set (inv 8). */
function checkAvailableDays(plan, allowedDows) {
  const v = [];
  for (const r of plan.workouts) {
    if (r.distance_mi > 0 && !allowedDows.has(r.dow)) {
      v.push(`AVAIL_VIOLATION ${r.date_iso} dow${r.dow} ${r.type} ${r.distance_mi}mi not in {${[...allowedDows].join(',')}}`);
    }
  }
  return v;
}

/** frequency cap: max running days in any week <= freq (inv 9). */
function checkFrequencyCap(plan, freq) {
  const v = [];
  const byWeek = new Map();
  for (const w of plan.workouts) {
    if (!byWeek.has(w.week_id)) byWeek.set(w.week_id, []);
    byWeek.get(w.week_id).push(w);
  }
  for (const wk of plan.weeks) {
    const rows = byWeek.get(wk.id) || [];
    const running = rows.filter((r) => r.distance_mi > 0).length;
    if (running > freq) {
      v.push(`FREQ_VIOLATION wk${wk.week_idx} ${wk.week_start_iso}: ${running} running days > freq ${freq}`);
    }
  }
  return v;
}

// ── scenario runners ────────────────────────────────────────────────────────
const RESULTS = [];
function record(id, scenario, input, violations, note = '') {
  RESULTS.push({ id, scenario, input: JSON.stringify(input), violations, note });
  const tag = violations.length === 0 ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${id} ${scenario} ${note}`);
  for (const x of violations) console.log('        ! ' + x);
}

/** Onboard with a race goal (race-prep) and read persisted rows.
 *  weeklyMi seeds recentWeeklyMi (0 runs); experienceLevel sets level;
 *  goal time sets goalPaceSec (tier). Returns {plan, genResp}. */
async function onboardRace({ distance, weeksOut, weeklyMi, weeklyFreq, experienceLevel, goalTime, longRunDay = 'sun', availableDays = null }) {
  const date = isoPlusDays(weeksOut * 7);
  const body = {
    distance, date, time: goalTime ?? null,
    weeklyMi, weeklyFreq, histAvg: null, histLong: null, histYears: null,
    experienceLevel,
    name: 'Test Runner', timezone: 'America/Los_Angeles',
    connectionsSkipped: true, longRunDay,
  };
  const resp = await api('/api/onboarding/complete', body);
  await sleep(400);
  const plan = await readActivePlan();
  return { resp, plan, date };
}

async function main() {
  await signIn();
  await db.connect();
  console.log(`signed in uid=${UID} token=${TOKEN.slice(0, 8)}...`);

  // ===========================================================================
  // (g) — THE CRITICAL ONE. Onboard intermediate/advanced at weeklyMi 25/35/45/55
  // with 5K and 10K goals (incl slow goal times). Assert EVERY persisted quality
  // row's distance_mi <= that week's long. This is the round-2 critical.
  // ===========================================================================
  console.log('\n=== (g) PERSIST-TIME quality<=long · 5K/10K × weeklyMi{25,35,45,55} × levels ===');
  const gMatrix = [];
  const dists = ['5k', '10k'];
  const mileages = [25, 35, 45, 55];
  const levels = ['intermediate', 'advanced'];
  // goal times: a fast and a SLOW one per distance to span tiers
  const goalTimes = {
    '5k': ['18:30', '30:00'],   // ~5:57/mi (fast) ... 9:39/mi (slow)
    '10k': ['38:00', '62:00'],  // ~6:07/mi (fast) ... 9:59/mi (slow)
  };
  let gCombos = 0;
  for (const distance of dists) {
    for (const weeklyMi of mileages) {
      for (const experienceLevel of levels) {
        for (const goalTime of goalTimes[distance]) {
          // 5K build window=10wk, 10K=12wk. Pick weeksOut INSIDE window so it's race-prep.
          const weeksOut = distance === '5k' ? 9 : 11;
          const { resp, plan } = await onboardRace({ distance, weeksOut, weeklyMi, weeklyFreq: 5, experienceLevel, goalTime });
          gCombos++;
          if (!plan) { record('g', `${distance} ${weeklyMi}mi ${experienceLevel} ${goalTime}`, { distance, weeklyMi, experienceLevel, goalTime }, [`NO PLAN PERSISTED (resp ${resp.status} ${JSON.stringify(resp.json?.plan ?? resp.json)})`]); continue; }
          // focus the violation set on quality<=long + spec/pace
          const vAll = checkPersisted(plan);
          const v = vAll.filter((x) => x.startsWith('QUALITY>LONG') || x.startsWith('NO_PACE') || x.startsWith('NO_SPEC') || x.startsWith('ZERO_MILE_RUN'));
          // also dump the quality vs long numbers for the report
          const qrows = plan.workouts.filter((r) => r.is_quality && r.type !== 'race');
          const sampleNote = `plan ${plan.plan.id.slice(0,12)} mode=${plan.plan.mode} q-rows=${qrows.length}`;
          gMatrix.push({ distance, weeklyMi, experienceLevel, goalTime, qmax: Math.max(0, ...qrows.map(r=>r.distance_mi)) });
          record('g', `${distance} ${weeklyMi}mi ${experienceLevel} ${goalTime}`, { distance, weeklyMi, experienceLevel, goalTime, weeksOut }, v, sampleNote);
        }
      }
    }
  }
  console.log(`(g) combos tested: ${gCombos}`);

  // ===========================================================================
  // (a) marathon no-plan dead-end -> now generates
  // ===========================================================================
  console.log('\n=== (a) marathon generates (no dead-end) ===');
  {
    // marathon build window = 18wk. Place inside -> race-prep. Beginner cold-start.
    const { resp, plan } = await onboardRace({ distance: 'marathon', weeksOut: 17, weeklyMi: 25, weeklyFreq: 5, experienceLevel: 'intermediate', goalTime: '3:45:00' });
    const v = [];
    if (!plan) v.push(`NO PLAN (resp ${resp.status} ${JSON.stringify(resp.json?.plan ?? resp.json)})`);
    else if (plan.workouts.length === 0) v.push('plan persisted but ZERO workouts');
    record('a', 'marathon 17wk intermediate 3:45', { distance: 'marathon', weeksOut: 17 }, v, plan ? `plan ${plan.plan.id.slice(0,12)} weeks=${plan.weeks.length} workouts=${plan.workouts.length}` : '');
  }

  // ===========================================================================
  // (b) race week respects available_days  +  (d) race-week freq cap reaches 1-2
  // Drive via /api/profile/goal which persists available_days then generates.
  // ===========================================================================
  console.log('\n=== (b)/(d) race-week available_days + freq cap (goal path) ===');
  {
    // Set a goal with available_days {tue, thu, sat} (3 days) and freq via profile.
    // First set weekly_frequency=2 on the profile via a fresh onboarding so the
    // race-week cap can be exercised, available_days via /api/profile/goal.
    await onboardRace({ distance: 'none', weeksOut: 0, weeklyMi: 25, weeklyFreq: 2, experienceLevel: 'intermediate', goalTime: null });
    const start = isoPlusDays(1);
    const resp = await api('/api/profile/goal', {
      distance_label: '10K', goal_time: '50:00', plan_weeks: 8,
      start_date: start, available_days: ['tue', 'thu', 'sat'],
    });
    await sleep(400);
    const plan = await readActivePlan();
    const allowed = new Set([2, 4, 6]); // tue thu sat
    const v = [];
    if (!plan) v.push(`NO PLAN (resp ${resp.status} ${JSON.stringify(resp.json)})`);
    else {
      v.push(...checkAvailableDays(plan, allowed));
      // race week = last week; freq cap 2 (weekly_frequency=2)
      v.push(...checkFrequencyCap(plan, 2));
    }
    // isolate race-week rows for explicit reporting
    let rwNote = '';
    if (plan) {
      const rw = plan.weeks.find((w) => w.is_race_week);
      if (rw) {
        const rwRows = plan.workouts.filter((r) => r.week_id === rw.id && r.distance_mi > 0);
        rwNote = `race-wk dows=[${rwRows.map(r=>r.dow).join(',')}] n=${rwRows.length}`;
      }
    }
    record('b+d', '10K goal avail{tue,thu,sat} freq2', { available_days: ['tue','thu','sat'], freq: 2 }, v, rwNote);
  }

  // ===========================================================================
  // (e) experience re-onboard flips (advanced -> beginner persists)
  // ===========================================================================
  console.log('\n=== (e) experience re-onboard flips ===');
  {
    await onboardRace({ distance: 'none', weeksOut: 0, weeklyMi: 25, weeklyFreq: 5, experienceLevel: 'advanced', goalTime: null });
    await sleep(200);
    const before = (await db.query(`SELECT experience_level FROM profile WHERE user_uuid=$1`, [UID])).rows[0]?.experience_level;
    await onboardRace({ distance: 'none', weeksOut: 0, weeklyMi: 25, weeklyFreq: 5, experienceLevel: 'beginner', goalTime: null });
    await sleep(200);
    const after = (await db.query(`SELECT experience_level FROM profile WHERE user_uuid=$1`, [UID])).rows[0]?.experience_level;
    const v = [];
    if (before !== 'advanced') v.push(`setup: expected advanced before flip, got ${before}`);
    if (after !== 'beginner') v.push(`FLIP FAILED: expected beginner after re-onboard, got ${after}`);
    record('e', 'advanced->beginner', { before, after }, v, `before=${before} after=${after}`);
  }

  // ===========================================================================
  // (f) no 0-mile running day (covered across all plans; assert on a fresh one)
  // ===========================================================================
  console.log('\n=== (f) no 0-mile running day (beginner 5K) ===');
  {
    const { plan } = await onboardRace({ distance: '5k', weeksOut: 9, weeklyMi: 15, weeklyFreq: 4, experienceLevel: 'beginner', goalTime: '32:00' });
    const v = plan ? checkPersisted(plan).filter((x) => x.startsWith('ZERO_MILE_RUN')) : ['NO PLAN'];
    record('f', 'beginner 5K 15mi', { distance: '5k', weeklyMi: 15 }, v, plan ? `workouts=${plan.workouts.length}` : '');
  }

  // ===========================================================================
  // (c) quality <= long (general, race-prep) — assert across ALL race-prep plans
  // generated so far (re-read the active beginner 5K + reuse g matrix outcome).
  // Already enforced inside (g)/(f). Add an explicit HM run.
  // ===========================================================================
  console.log('\n=== (c) quality<=long general (HM intermediate) ===');
  {
    const { plan } = await onboardRace({ distance: 'half', weeksOut: 13, weeklyMi: 35, weeklyFreq: 5, experienceLevel: 'intermediate', goalTime: '1:45:00' });
    const v = plan ? checkPersisted(plan).filter((x) => x.startsWith('QUALITY>LONG') || x.startsWith('EASY>LONG')) : ['NO PLAN'];
    record('c', 'HM 13wk intermediate 35mi', { distance: 'half', weeklyMi: 35 }, v, plan ? `weeks=${plan.weeks.length}` : '');
  }

  // ===========================================================================
  // MAINTENANCE (i, j, k) — far-off 5K/10K race -> maintenance (no long-cap throw)
  // ===========================================================================
  console.log('\n=== (i)/(j)/(k) MAINTENANCE toward far-off short race ===');
  {
    // Need recent volume + long so maintenance has a base to hold. Re-onboard with
    // weeklyMi 35 + histLong so recentLongMi>0. Then create a far-off 5K race
    // (28 weeks out > 10wk build window) and generate against it.
    await deleteAllRaces();
    // set self-report base via onboarding (no race) with histLong 6-10 -> long 8mi
    await api('/api/onboarding/complete', {
      distance: 'none', weeklyMi: 35, weeklyFreq: 4, histAvg: null,
      histLong: '6-10', histYears: '3-7', experienceLevel: 'intermediate',
      name: 'Test Runner', timezone: 'America/Los_Angeles', connectionsSkipped: true,
      longRunDay: 'sun',
    });
    await sleep(300);
    // available days for maintenance test: 4 days {mon, wed, fri, sun}
    await api('/api/profile/goal', { distance_label: '5K', goal_time: '22:00', plan_weeks: 8, available_days: ['mon','wed','fri','sun'] }).catch(()=>{});
    await sleep(200);
    // Now create a far-off A-race 5K (200 days out) and generate -> maintenance
    const farDate = isoPlusDays(200);
    const rc = await api('/api/race', { name: 'Far 5K', date: farDate, distance_label: '5K', priority: 'A', goal: '22:00' });
    const slug = rc.json?.slug || rc.json?.race?.slug;
    let v = [];
    let note = '';
    if (!slug) { v.push(`race create failed: ${rc.status} ${JSON.stringify(rc.json)}`); }
    else {
      const gen = await api('/api/plan/generate', { raceSlug: slug });
      await sleep(400);
      const plan = await readActivePlan();
      if (!plan) v.push(`NO PLAN (gen ${gen.status} ${JSON.stringify(gen.json)})`);
      else {
        note = `mode=${plan.plan.mode} weeks=${plan.weeks.length} workouts=${plan.workouts.length}`;
        if (plan.plan.mode !== 'maintenance') v.push(`EXPECTED maintenance, got mode=${plan.plan.mode}`);
        // (i) generated at all (no throw) — implied by plan != null
        // (j) available_days respected
        v.push(...checkAvailableDays(plan, new Set([1,3,5,0])));
        // (k) frequency cap = 4
        v.push(...checkFrequencyCap(plan, 4));
        // also 7-day weeks + no zero-mile run
        v.push(...check7Days(plan));
        v.push(...checkPersisted(plan).filter((x)=>x.startsWith('ZERO_MILE_RUN')));
      }
    }
    record('i+j+k', 'maintenance far-off 5K avail{mon,wed,fri,sun} freq4', { farDate, available_days:['mon','wed','fri','sun'], freq:4 }, v, note);
  }

  // ===========================================================================
  // RECOVERY (h, j, k, l) — recent past A-marathon -> recovery block generates
  // ===========================================================================
  console.log('\n=== (h)/(l)/(j)/(k) RECOVERY after recent marathon ===');
  {
    await deleteAllRaces();
    // base: weeklyMi 45 + long 12 so recovery has a peak to cut back from
    await api('/api/onboarding/complete', {
      distance: 'none', weeklyMi: 45, weeklyFreq: 5, histAvg: null,
      histLong: '10+', histYears: '7+', experienceLevel: 'advanced',
      name: 'Test Runner', timezone: 'America/Los_Angeles', connectionsSkipped: true,
      longRunDay: 'sun',
    });
    await sleep(300);
    await api('/api/profile/goal', { distance_label: '10K', goal_time: '40:00', plan_weeks: 10, available_days: ['mon','tue','thu','sat','sun'] }).catch(()=>{});
    await sleep(200);
    // recent past A-marathon: finished 5 days ago (recovery window for M = 2 weeks)
    const pastDate = isoPlusDays(-5);
    await api('/api/race', { name: 'Past Marathon', date: pastDate, distance_label: 'Marathon', priority: 'A', goal: '3:30:00' });
    // future anchor race for the generator (recovery check fires first regardless):
    // place it within build window so loadGeneratorInputs is happy; recovery wins.
    const futDate = isoPlusDays(60);
    const rc = await api('/api/race', { name: 'Future 10K', date: futDate, distance_label: '10K', priority: 'A', goal: '40:00' });
    const slug = rc.json?.slug || rc.json?.race?.slug;
    let v = [];
    let note = '';
    if (!slug) v.push(`future race create failed: ${rc.status} ${JSON.stringify(rc.json)}`);
    else {
      const gen = await api('/api/plan/generate', { raceSlug: slug });
      await sleep(400);
      const plan = await readActivePlan();
      if (!plan) v.push(`NO PLAN (gen ${gen.status} ${JSON.stringify(gen.json)})`);
      else {
        note = `mode=${plan.plan.mode} weeks=${plan.weeks.length} workouts=${plan.workouts.length}`;
        // (h)+(l): recovery generated (reachable) — mode must be recovery
        if (plan.plan.mode !== 'recovery') v.push(`EXPECTED recovery, got mode=${plan.plan.mode}`);
        // (l) recovery shape: each week has >=2 rest days, all easy/rest (no quality)
        const byWeek = new Map();
        for (const w of plan.workouts) { if (!byWeek.has(w.week_id)) byWeek.set(w.week_id, []); byWeek.get(w.week_id).push(w); }
        for (const wk of plan.weeks) {
          const rows = byWeek.get(wk.id) || [];
          const restCount = rows.filter((r) => r.type === 'rest').length;
          const qualityCount = rows.filter((r) => r.is_quality).length;
          const running = rows.filter((r) => r.distance_mi > 0).length;
          if (restCount < 2) v.push(`RECOVERY_REST<2 wk${wk.week_idx}: ${restCount} rest days`);
          if (qualityCount > 0) v.push(`RECOVERY_HAS_QUALITY wk${wk.week_idx}: ${qualityCount}`);
          // day-sum vs field divergence: sum of distances should be > 0 and not absurd
          const sum = rows.reduce((s, r) => s + r.distance_mi, 0);
          if (!(sum > 0)) v.push(`RECOVERY_ZERO_VOLUME wk${wk.week_idx}`);
        }
        // (j) available_days respected
        v.push(...checkAvailableDays(plan, new Set([1,2,4,6,0])));
        // (k) frequency cap = 5
        v.push(...checkFrequencyCap(plan, 5));
        v.push(...check7Days(plan));
      }
    }
    record('h+l+j+k', 'recovery past-marathon(-5d) freq5', { pastDate, futDate, freq:5 }, v, note);
  }

  // ===========================================================================
  // CONCURRENCY — two near-simultaneous generatePlan calls -> exactly 1 active
  // ===========================================================================
  console.log('\n=== CONCURRENCY: 2 simultaneous generate -> exactly 1 active plan ===');
  {
    await deleteAllRaces();
    const futDate = isoPlusDays(56);
    const rc = await api('/api/race', { name: 'Concurrency 10K', date: futDate, distance_label: '10K', priority: 'A', goal: '45:00' });
    const slug = rc.json?.slug || rc.json?.race?.slug;
    let v = [];
    let note = '';
    if (!slug) v.push(`race create failed ${rc.status}`);
    else {
      // fire both without awaiting between
      const [r1, r2] = await Promise.all([
        api('/api/plan/generate', { raceSlug: slug }),
        api('/api/plan/generate', { raceSlug: slug }),
      ]);
      await sleep(600);
      const n = await countActivePlans();
      note = `gen1=${r1.status} gen2=${r2.status} activePlans=${n}`;
      if (n !== 1) v.push(`EXPECTED exactly 1 active plan, got ${n}`);
    }
    record('concurrency', '2x generate same race', { futDate }, v, note);
  }

  // ── summary ───────────────────────────────────────────────────────────────
  await db.end();
  const fails = RESULTS.filter((r) => r.violations.length > 0);
  console.log('\n================ SUMMARY ================');
  console.log(`scenarios: ${RESULTS.length}  PASS: ${RESULTS.length - fails.length}  FAIL: ${fails.length}`);
  console.log('\n--- JSON ---');
  console.log(JSON.stringify({ gMatrix, results: RESULTS }, null, 2));
}

main().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
