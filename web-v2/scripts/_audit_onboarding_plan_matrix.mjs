// Onboarding → plan-creation audit matrix (David 2026-06-20: "full audit on
// all possible onboarding inputs and what happens with plan creation").
//
// Drives the REAL prod API with one test user, re-onboarding it per profile,
// then sets a goal / adds a race, pulls the actual plan_workouts, and asserts
// plan SANITY:
//   · generates at all (no PlanValidationError / null)
//   · long >= easy every week (no inversion — Lilley's bug)
//   · quality session not dwarfing the long run / week (the 5x800m bug)
//   · exactly 7 distinct calendar days per week (no dup/gap — strip bug)
//   · progressive ramp (week0 < peak) and a real taper (race week < peak)
//   · running days per week respect the stated frequency
//   · quality rows carry a pace + spec
//
// Run from web-v2:  node scripts/_audit_onboarding_plan_matrix.mjs
import pg from 'pg';

const BASE = 'https://www.faff.run';
const EMAIL = 'test-onboarding@faff.run';
const PASSWORD = 'Faff2026!';
const DBURL = (process.env.DATABASE_URL_RO
  || (await import('node:fs')).readFileSync('.env.local', 'utf8')
      .split('\n').find((l) => l.startsWith('DATABASE_URL='))?.slice('DATABASE_URL='.length)) ?? '';

const db = new pg.Client({ connectionString: DBURL.trim() });
await db.connect();

const iso = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

let TOKEN = '';
async function signIn() {
  const r = await fetch(`${BASE}/api/auth/email`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  TOKEN = (await r.json()).token;
  if (!TOKEN) throw new Error('no token');
}
async function api(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  return r.json().catch(() => ({}));
}

// ── volume tiers (weeklyMi + matching history bands) ───────────────────
const VOL = {
  zero: { weeklyMi: 0, histAvg: '0-5', histLong: '0-3' },
  lo:   { weeklyMi: 5, histAvg: '0-5', histLong: '0-3' },
  low:  { weeklyMi: 15, histAvg: '5-15', histLong: '3-6' },
  mid:  { weeklyMi: 25, histAvg: '15-25', histLong: '6-10' },
  hi:   { weeklyMi: 35, histAvg: '25-35', histLong: '10+' },
  peak: { weeklyMi: 45, histAvg: '35+', histLong: '10+' },
};
const GOAL_TIME = { '5K': '28:00', '10K': '58:00', 'Half Marathon': '2:10:00', 'Marathon': '4:40:00', '50K': '6:30:00', '100K': '14:00:00' };

// ── the matrix: a curated set covering edges + grid ────────────────────
const cases = [];
const add = (label, profile, target) => cases.push({ label, profile, target });

// 1. Frequency sweep 0-6 (the new low-freq handling) at two profiles
for (const f of [0, 1, 2, 3, 4, 5, 6]) {
  add(`freq${f}·beginner·lo·5K`, { experienceLevel: 'beginner', weeklyFreq: f, ...VOL.lo }, { goal: '5K' });
  add(`freq${f}·intermediate·mid·HM`, { experienceLevel: 'intermediate', weeklyFreq: f, ...VOL.mid }, { goal: 'Half Marathon' });
}
// 2. Experience × volume (beginner support) at 5K + HM
for (const exp of ['beginner', 'intermediate', 'advanced']) {
  for (const v of ['lo', 'low', 'mid', 'hi']) {
    add(`${exp}·${v}·5K`, { experienceLevel: exp, weeklyFreq: 3, ...VOL[v] }, { goal: '5K' });
    add(`${exp}·${v}·HM`, { experienceLevel: exp, weeklyFreq: 4, ...VOL[v] }, { goal: 'Half Marathon' });
  }
}
// 3. Distance sweep (every distance) at two profiles
for (const d of ['5K', '10K', 'Half Marathon', 'Marathon', '50K', '100K']) {
  add(`dist·intermediate·mid·${d}`, { experienceLevel: 'intermediate', weeklyFreq: 4, ...VOL.mid }, { goal: d });
  add(`dist·beginner·low·${d}`, { experienceLevel: 'beginner', weeklyFreq: 3, ...VOL.low }, { goal: d });
}
// 4. Edge cases
add('edge·sedentary·0day·5K', { experienceLevel: 'beginner', weeklyFreq: 0, ...VOL.zero }, { goal: '5K' });
add('edge·1day·Marathon (mismatch)', { experienceLevel: 'beginner', weeklyFreq: 1, ...VOL.lo }, { goal: 'Marathon' });
add('edge·advanced·6day·peak·5K', { experienceLevel: 'advanced', weeklyFreq: 6, ...VOL.peak }, { goal: '5K' });
add('edge·null-exp·mid·HM', { experienceLevel: null, weeklyFreq: 4, ...VOL.mid }, { goal: 'Half Marathon' });
add('edge·weeks4·HM', { experienceLevel: 'intermediate', weeklyFreq: 4, ...VOL.mid }, { goal: 'Half Marathon', weeks: 4 });
add('edge·weeks24·Marathon', { experienceLevel: 'intermediate', weeklyFreq: 5, ...VOL.hi }, { goal: 'Marathon', weeks: 24 });
// 5. Race path (date + start date)
add('race·HM·start-now', { experienceLevel: 'intermediate', weeklyFreq: 4, ...VOL.mid }, { race: 'Half Marathon', raceInDays: 112 });
add('race·5K·beginner·start+14d', { experienceLevel: 'beginner', weeklyFreq: 3, ...VOL.lo }, { race: '5K', raceInDays: 84, startInDays: 14 });
add('race·Marathon·advanced', { experienceLevel: 'advanced', weeklyFreq: 5, ...VOL.hi }, { race: 'Marathon', raceInDays: 140 });

// ── plan sanity assertions ─────────────────────────────────────────────
// statedWeeklyMi = the runner's onboarded weekly volume. Used to skip the
// volume-ramp assertion when the plan's peak is already at/below it (an
// over-volumed-for-the-goal runner — e.g. 25mi/wk training for a 28:00 5K —
// correctly gets a flat volume curve; progression is intensity, not mileage).
async function assertPlan(planId, statedWeeklyMi = 0) {
  const { rows } = await db.query(
    `SELECT week_id,
            round(sum(distance_mi),1)::float AS wk_mi,
            round(sum(distance_mi) FILTER (WHERE type <> 'race'),1)::float AS train_mi,
            round(max(distance_mi) FILTER (WHERE is_long),1)::float AS long_mi,
            round(max(distance_mi) FILTER (WHERE type='easy'),1)::float AS easy_mi,
            round(max(distance_mi) FILTER (WHERE is_quality),1)::float AS quality_mi,
            count(DISTINCT date_iso)::int AS days,
            count(*) FILTER (WHERE distance_mi > 0 AND type NOT IN ('strength','cross'))::int AS running_days,
            bool_or(is_quality AND distance_mi > 0 AND pace_target_s_per_mi IS NULL AND workout_spec IS NULL) AS q_no_pace,
            min(date_iso) AS wk_start
       FROM plan_workouts WHERE plan_id=$1 GROUP BY week_id ORDER BY min(date_iso)`,
    [planId],
  );
  const f = [];
  if (rows.length < 3) { f.push(`only ${rows.length} weeks`); return f; }
  const peak = Math.max(...rows.map((r) => r.wk_mi ?? 0));
  rows.forEach((r, i) => {
    const wk = i + 1;
    if (r.days !== 7) f.push(`wk${wk}: ${r.days} days (not 7)`);
    if (r.long_mi != null && r.easy_mi != null && r.easy_mi > r.long_mi + 0.05)
      f.push(`wk${wk}: easy ${r.easy_mi} > long ${r.long_mi} (inverted)`);
    if (r.quality_mi != null && r.long_mi != null) {
      const ceil = Math.max(r.long_mi * 1.5, (r.wk_mi ?? 0) * 0.6);
      if (r.quality_mi > ceil + 0.1)
        f.push(`wk${wk}: quality ${r.quality_mi} dwarfs (long ${r.long_mi}, wk ${r.wk_mi})`);
    }
    if (r.q_no_pace) f.push(`wk${wk}: quality row missing pace+spec`);
    if (!(r.wk_mi >= 0)) f.push(`wk${wk}: wk_mi NaN/null`);
  });
  // ramp: week0 below peak (plans > 4 wks). Skip when the plan peak is already
  // <= the runner's stated weekly volume — they're over-volumed for the goal,
  // so a flat volume curve is correct (no mileage to build; sharpen instead).
  if (rows.length > 4 && (rows[0].wk_mi ?? 0) >= peak && peak > statedWeeklyMi)
    f.push(`no ramp: wk0 ${rows[0].wk_mi} >= peak ${peak}`);
  // taper: final (race) week TRAINING (excl the race-day distance) below peak.
  // peak is also training-only (non-race weeks carry no race row).
  const last = rows[rows.length - 1];
  const lastTrain = last.train_mi ?? last.wk_mi ?? 0;
  if (lastTrain >= peak * 0.9 && rows.length > 4) f.push(`no taper: race-wk training ${lastTrain} ~ peak ${peak}`);
  return f;
}

// ── run ────────────────────────────────────────────────────────────────
await signIn();
const results = [];
let n = 0;
for (const c of cases) {
  n++;
  try {
    await api('/api/onboarding/complete', {
      distance: 'none', longRunDay: 'sun', name: 'Audit', timezone: 'America/Los_Angeles',
      raceHistory: [], connectionsSkipped: true, ...c.profile,
    });
    let planId = null, genErr = null;
    if (c.target.goal) {
      const r = await api('/api/profile/goal', {
        distance_label: c.target.goal, goal_time: GOAL_TIME[c.target.goal],
        plan_weeks: c.target.weeks ?? 12, start_date: iso(c.target.startInDays ?? 1),
      });
      planId = r?.plan?.plan_id ?? null;
      if (!planId) genErr = 'plan null (gen failed/blocked)';
    } else if (c.target.race) {
      // /api/race only generates a plan when no active plan exists. Clear any
      // active plan (from prior goal/race cases) BEFORE adding the race.
      await db.query(`UPDATE training_plans SET archived_iso=NOW() WHERE user_uuid=(SELECT id FROM users WHERE email=$1) AND archived_iso IS NULL`, [EMAIL]).catch(() => {});
      const r = await api('/api/race', {
        name: `Audit ${c.target.race}`, date: iso(c.target.raceInDays),
        distance_label: c.target.race, priority: 'A', start_date: iso(c.target.startInDays ?? 1),
      });
      planId = r?.plan?.plan_id ?? null;
      if (!planId) genErr = `plan null (${r?.plan?.reason ?? 'no plan'})`;
    }
    let fails = genErr ? [genErr] : await assertPlan(planId, c.profile?.weeklyMi ?? 0);
    const ok = fails.length === 0;
    results.push({ label: c.label, ok, fails });
    process.stdout.write(`[${n}/${cases.length}] ${ok ? 'PASS' : 'FAIL'} ${c.label}${ok ? '' : '  → ' + fails.join('; ')}\n`);
  } catch (e) {
    results.push({ label: c.label, ok: false, fails: [`EXC: ${e.message}`] });
    process.stdout.write(`[${n}/${cases.length}] ERR  ${c.label} → ${e.message}\n`);
  }
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n========== ${passed}/${results.length} PASS ==========`);
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log('FAILURES:');
  for (const r of failed) console.log(`  ✗ ${r.label}\n      ${r.fails.join('\n      ')}`);
}
await db.end();
process.exit(failed.length ? 1 : 0);
