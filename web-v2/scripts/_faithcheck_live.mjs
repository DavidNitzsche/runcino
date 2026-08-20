// FAITHFULNESS CHECKER · live driver.
// For ~8 representative runner setups: set the test user's profile state,
// drive the LIVE prod API to generate a plan, then read back BOTH the real
// ComposePlanInput (from authored_state.derived_from + settings) and the
// persisted weekly structure. Writes everything to /tmp/_faithcheck.json for
// the offline sidecar to diff against composePlan().
//
// Test user only (b8b75dd8…). Resets state after each case.
import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import pg from 'pg';

const BASE = 'https://www.faff.run';
const USER_ID = 'b8b75dd8-2a04-48b4-8896-44897d9e0b25';
const EMAIL = 'test-onboarding@faff.run';
const PASS = 'Faff2026!';

function envVal(k) {
  try {
    const t = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    const m = t.match(new RegExp('^' + k + '=(.*)$', 'm'));
    return m ? m[1].replace(/^["']|["']$/g, '').trim() : undefined;
  } catch { return undefined; }
}
const RW = process.env.DATABASE_URL || envVal('DATABASE_URL');
const RO = process.env.DATABASE_URL_RO || envVal('DATABASE_URL_RO') || RW;
const dbrw = new pg.Pool({ connectionString: RW, ssl: { rejectUnauthorized: false } });
const dbro = new pg.Pool({ connectionString: RO, ssl: { rejectUnauthorized: false } });

let TOKEN = '';
async function login() {
  const r = await fetch(`${BASE}/api/auth/email`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  TOKEN = (await r.json()).token;
  if (!TOKEN) throw new Error('login failed');
}
async function api(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}

// Reset: archive plans, clear races/goal/available_days, set profile knobs.
async function resetAndSeed(seed) {
  await dbrw.query(`UPDATE training_plans SET archived_iso = NOW() WHERE user_uuid=$1 AND archived_iso IS NULL`, [USER_ID]);
  await dbrw.query(`DELETE FROM races WHERE user_uuid=$1`, [USER_ID]);
  // Reset profile knobs to the seed. experience_level set directly (bypass the
  // onboarding COALESCE so each case is clean).
  await dbrw.query(
    `UPDATE profile SET
       experience_level = $2,
       weekly_frequency = $3,
       weekly_mileage_target = $4,
       history_avg_weekly_mi = $5,
       history_longest_recent_mi = $6,
       cross_training_modes = '{}'::text[],
       lthr = NULL,
       tt_goal_distance = NULL, tt_goal_time = NULL, tt_goal_time_seconds = NULL, tt_goal_plan_weeks = NULL,
       user_settings = COALESCE(user_settings,'{}'::jsonb)
                       - 'available_days' - 'quality_days'
                       || jsonb_build_object('long_run_day', $7::text, 'rest_day', $8::text)
                       || $9::jsonb
     WHERE user_uuid=$1`,
    [USER_ID, seed.level, seed.freq, seed.weeklyTarget, seed.histAvg, seed.histLong,
     seed.longDay ?? 'sun', seed.restDay ?? 'sat',
     seed.availDays ? JSON.stringify({ available_days: seed.availDays }) : '{}'],
  );
}

// Read back the real ComposePlanInput-relevant fields + persisted week structure.
async function readBack() {
  const plan = (await dbro.query(
    `SELECT id, authored_state FROM training_plans WHERE user_uuid=$1 AND archived_iso IS NULL ORDER BY authored_iso DESC LIMIT 1`,
    [USER_ID],
  )).rows[0];
  if (!plan) return { ok: false, reason: 'no active plan' };
  const settings = (await dbro.query(`SELECT user_settings FROM profile WHERE user_uuid=$1`, [USER_ID])).rows[0]?.user_settings ?? {};
  // Per-week structure from plan_workouts.
  const weeks = (await dbro.query(
    `SELECT week_id,
        min(date_iso)::text AS wk_start,
        round(sum(distance_mi),2)::float AS wk_mi,
        round(sum(distance_mi) FILTER (WHERE type<>'race'),2)::float AS train_mi,
        round(max(distance_mi) FILTER (WHERE is_long AND type<>'race'),2)::float AS long_mi,
        round(max(distance_mi) FILTER (WHERE type IN ('easy','recovery','shakeout')),2)::float AS easy_mi,
        round(max(distance_mi) FILTER (WHERE is_quality AND type<>'race' AND type<>'long'),2)::float AS quality_mi,
        count(DISTINCT date_iso)::int AS days,
        count(*) FILTER (WHERE distance_mi>0 AND type NOT IN ('strength','cross','xt','rest'))::int AS running_days,
        string_agg(DISTINCT (dow::text || ':' || type), ',' ORDER BY (dow::text || ':' || type)) AS day_types
       FROM plan_workouts WHERE plan_id=$1
      GROUP BY week_id ORDER BY min(date_iso)`,
    [plan.id],
  )).rows;
  return { ok: true, planId: plan.id, authored: plan.authored_state, settings, weeks };
}

// 8 representative setups spanning the realistic onboarding space.
// weeklyTarget MUST be a banded value: {0,5,15,25,35,45,55} (DB check constraint
// profile_weekly_mileage_target_check — which exactly matches the offline sweep's
// recentWeeklyMi domain). histAvg/histLong are free numerics (onboarding bands
// them in practice but the column has no constraint).
const SETUPS = [
  // cold-start true beginner, 3-day, low volume, 5K goal
  { name: 'beginner_3day_5K_coldstart', seed: { level: 'beginner', freq: 3, weeklyTarget: 15, histAvg: 10, histLong: 4 },
    gen: { path: 'goal', distance_label: '5K', goal_time: '30:00', plan_weeks: 12 } },
  // intermediate, 4-day, 25mpw, HM goal
  { name: 'intermediate_4day_HM', seed: { level: 'intermediate', freq: 4, weeklyTarget: 25, histAvg: 25, histLong: 8 },
    gen: { path: 'goal', distance_label: 'Half Marathon', goal_time: '1:45:00', plan_weeks: 16 } },
  // advanced, 5-day, 45mpw, Marathon goal (PROTECTED-adjacent, but cold so not David)
  { name: 'advanced_5day_Marathon', seed: { level: 'advanced', freq: 5, weeklyTarget: 45, histAvg: 45, histLong: 16 },
    gen: { path: 'goal', distance_label: 'Marathon', goal_time: '3:15:00', plan_weeks: 16 } },
  // null level (unset), 3-day, 15mpw, 10K
  { name: 'nulllevel_3day_10K', seed: { level: null, freq: 3, weeklyTarget: 15, histAvg: 15, histLong: 6 },
    gen: { path: 'goal', distance_label: '10K', goal_time: '50:00', plan_weeks: 12 } },
  // available-days: weekends-only, intermediate, HM, 2-day freq
  { name: 'inter_weekendsonly_HM', seed: { level: 'intermediate', freq: 2, weeklyTarget: 25, histAvg: 20, histLong: 8, availDays: ['sat','sun'] },
    gen: { path: 'goal', distance_label: 'Half Marathon', goal_time: '1:50:00', plan_weeks: 16 } },
  // available-days: MWF (long-day Sun unavailable → relocation), beginner, 10K
  { name: 'beg_MWF_10K', seed: { level: 'beginner', freq: 3, weeklyTarget: 15, histAvg: 8, histLong: 4, availDays: ['mon','wed','fri'] },
    gen: { path: 'goal', distance_label: '10K', goal_time: '1:00:00', plan_weeks: 12 } },
  // RACE path (race row with date), advanced, HM, fast goal
  { name: 'race_advanced_HM_racepath', seed: { level: 'advanced', freq: 5, weeklyTarget: 45, histAvg: 40, histLong: 12 },
    gen: { path: 'race', distanceLabel: 'Half Marathon', goalDisplay: '1:25', weeksOut: 14 } },
  // over-volumed: advanced_plus, 6-day, 55mpw but a SLOW 5K goal (flat curve case)
  { name: 'advplus_6day_5K_overvolumed', seed: { level: 'advanced_plus', freq: 6, weeklyTarget: 55, histAvg: 55, histLong: 14 },
    gen: { path: 'goal', distance_label: '5K', goal_time: '28:00', plan_weeks: 16 } },
];

async function drive(setup) {
  await resetAndSeed(setup.seed);
  const g = setup.gen;
  if (g.path === 'goal') {
    const body = { distance_label: g.distance_label, goal_time: g.goal_time, plan_weeks: g.plan_weeks };
    if (setup.seed.availDays) body.available_days = setup.seed.availDays;
    const r = await api('POST', '/api/profile/goal', body);
    if (r.status !== 200) return { ok: false, reason: `goal POST ${r.status}: ${JSON.stringify(r.json)}` };
  } else if (g.path === 'race') {
    // create race with a date weeksOut from today
    const today = new Date();
    const raceDate = new Date(today.getTime() + g.weeksOut * 7 * 86400000).toISOString().slice(0, 10);
    const r = await api('POST', '/api/race', {
      name: `Faithcheck ${setup.name}`,
      date: raceDate,
      distance_label: g.distanceLabel,
      goal: g.goalDisplay,
      priority: 'A',
    });
    if (r.status !== 200 && r.status !== 201) return { ok: false, reason: `race POST ${r.status}: ${JSON.stringify(r.json)}` };
    // race POST may or may not auto-generate; trigger plan gen explicitly via /api/plan/generate if needed
    const slug = r.json?.slug || r.json?.race?.slug;
    // give the server a moment, then check for a plan; if none, hit generate
    await new Promise((res) => setTimeout(res, 800));
    let rb = await readBack();
    if (!rb.ok && slug) {
      const gr = await api('POST', '/api/plan/generate', { raceSlug: slug });
      void gr;
      await new Promise((res) => setTimeout(res, 800));
    }
  }
  await new Promise((res) => setTimeout(res, 600));
  return await readBack();
}

(async () => {
  await login();
  const out = [];
  for (const setup of SETUPS) {
    process.stderr.write(`\n=== ${setup.name} ===\n`);
    try {
      const rb = await drive(setup);
      if (!rb.ok) { process.stderr.write(`  FAIL: ${rb.reason}\n`); out.push({ name: setup.name, seed: setup.seed, gen: setup.gen, error: rb.reason }); continue; }
      const df = rb.authored?.derived_from ?? {};
      process.stderr.write(`  planId=${rb.planId} weeks=${rb.weeks.length}\n`);
      process.stderr.write(`  REAL derived_from: recentWeeklyMi=${df.recentWeeklyMi} recentLongMi=${df.recentLongMi} easyDayMedianMi=${df.easyDayMedianMi} bestVdot=${df.bestRecentVdot}\n`);
      process.stderr.write(`  authored: goal_pace=${rb.authored?.goal_pace_s_per_mi} t_pace=${rb.authored?.t_pace_s_per_mi} tier=${rb.authored?.goal_tier} peakBand=${JSON.stringify(rb.authored?.tier_peak_weekly_band)}\n`);
      process.stderr.write(`  settings: long=${rb.settings?.long_run_day} rest=${rb.settings?.rest_day} avail=${JSON.stringify(rb.settings?.available_days)} quality=${JSON.stringify(rb.settings?.quality_days)}\n`);
      const wk0 = rb.weeks[0], wkPeak = rb.weeks.reduce((a,b)=>(b.wk_mi>a.wk_mi?b:a), rb.weeks[0]);
      process.stderr.write(`  wk0: mi=${wk0.wk_mi} long=${wk0.long_mi} easy=${wk0.easy_mi} q=${wk0.quality_mi} days=${wk0.days} run=${wk0.running_days}\n`);
      process.stderr.write(`  peak: mi=${wkPeak.wk_mi} long=${wkPeak.long_mi} easy=${wkPeak.easy_mi} run=${wkPeak.running_days}\n`);
      out.push({ name: setup.name, seed: setup.seed, gen: setup.gen, real: { derived_from: df, authored: rb.authored, settings: rb.settings, weeks: rb.weeks } });
    } catch (e) {
      process.stderr.write(`  ERROR: ${e.message}\n`);
      out.push({ name: setup.name, seed: setup.seed, gen: setup.gen, error: e.message });
    }
  }
  // cleanup: archive plans, clear races/goal/available_days, null experience.
  await dbrw.query(`UPDATE training_plans SET archived_iso=NOW() WHERE user_uuid=$1 AND archived_iso IS NULL`, [USER_ID]);
  await dbrw.query(`DELETE FROM races WHERE user_uuid=$1`, [USER_ID]);
  await dbrw.query(
    `UPDATE profile SET experience_level=NULL, tt_goal_distance=NULL, tt_goal_time=NULL, tt_goal_time_seconds=NULL, tt_goal_plan_weeks=NULL,
       user_settings = COALESCE(user_settings,'{}'::jsonb) - 'available_days' - 'quality_days'
     WHERE user_uuid=$1`, [USER_ID]);
  writeFileSync('/tmp/_faithcheck.json', JSON.stringify(out, null, 2));
  process.stderr.write(`\nWROTE /tmp/_faithcheck.json (${out.length} cases, ${out.filter(o=>!o.error).length} ok)\n`);
  await dbrw.end(); await dbro.end();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
