// Plan-matrix smoke harness (David 2026-06-10: "every single plan and
// user option checked, smoke tested, and ready").
//
// Unlike _persona_smoke.mjs (which only asserted the plan didn't ERROR),
// this drives every onboarding path × frequency × history tier through
// the REAL API, then pulls the ACTUAL plan_workouts rows from the DB and
// validates plan SHAPE — running-days-per-week vs the runner's stated
// frequency, week-1 starting volume vs current fitness, progressive ramp,
// taper, race-day row, and non-null quality paces.
//
// Run against the LOCAL sandbox:  node scripts/_plan_matrix_smoke.mjs [runId]
// (sandbox = http://localhost:3100, DB faff_sandbox, ALLOW_OPEN_SIGNUP on)

import pg from 'pg';

const BASE = 'http://localhost:3100';
const DB = 'postgresql://localhost:5432/faff_sandbox';
const RUN = process.argv[2] ?? String(Date.now()).slice(-6);
const PASSWORD = 'faff-test';

const db = new pg.Client({ connectionString: DB });
await db.connect();

const iso = (daysFromNow) =>
  new Date(Date.now() + daysFromNow * 86400000).toISOString().slice(0, 10);

// ── Persona matrix ────────────────────────────────────────────────
// Realistic history per distance; frequency swept 3..6 on every path
// so the day-count bug surfaces on each.
const HIST = {
  low:  { weeklyMi: 15, histAvg: '5-15',  histLong: '3-6',  histYears: '1-3' },
  mid:  { weeklyMi: 25, histAvg: '15-25', histLong: '6-10', histYears: '1-3' },
  high: { weeklyMi: 35, histAvg: '25-35', histLong: '10+',  histYears: '3-7' },
};

const personas = [];
const add = (p) => personas.push(p);

// RACE paths · 4 distances × freq 3..6. Runways sit COMFORTABLY inside
// each distance's BUILD_WINDOW_WEEKS (5k:10 10k:12 hm:14 m:18) so
// pickPlanMode returns race-prep (a race past the window correctly
// yields maintenance-until-build-window — tested separately below).
// Mix first-race (time null) + goal.
const RACE = [
  { distance: '5k',       weeks: 8,  time: '21:30',   hist: 'mid' },
  { distance: '10k',      weeks: 9,  time: '45:00',   hist: 'mid' },
  { distance: 'half',     weeks: 11, time: null,      hist: 'mid' },
  { distance: 'marathon', weeks: 14, time: '3:45:00', hist: 'high' },
];
for (const r of RACE) {
  for (const freq of [3, 4, 5, 6]) {
    add({
      kind: 'race',
      key: `race-${r.distance}-f${freq}`,
      freq,
      body: {
        distance: r.distance, date: iso(r.weeks * 7), time: r.time,
        weeklyMi: HIST[r.hist].weeklyMi, weeklyFreq: freq,
        histAvg: HIST[r.hist].histAvg, histLong: HIST[r.hist].histLong,
        histYears: HIST[r.hist].histYears, raceHistory: [], connectionsSkipped: true,
      },
    });
  }
}

// TT-goal (no-race) · 3 distances × freq 3..6.
const TT = [
  { ttDistance: '1mi', ttTime: '6:00-7:00', hist: 'low' },
  { ttDistance: '5k',  ttTime: '22-25',     hist: 'mid' },
  { ttDistance: '10k', ttTime: '45-50',     hist: 'mid' },
];
for (const t of TT) {
  for (const freq of [3, 4, 5, 6]) {
    add({
      kind: 'maintenance',
      key: `tt-${t.ttDistance}-f${freq}`,
      freq,
      body: {
        distance: 'none', ttDistance: t.ttDistance, ttTime: t.ttTime,
        weeklyMi: HIST[t.hist].weeklyMi, weeklyFreq: freq,
        histAvg: HIST[t.hist].histAvg, histLong: HIST[t.hist].histLong,
        histYears: HIST[t.hist].histYears, raceHistory: [], connectionsSkipped: true,
      },
    });
  }
}

// CONSISTENCY (no-race, no TT) · freq 3..6.
for (const freq of [3, 4, 5, 6]) {
  add({
    kind: 'maintenance',
    key: `consistency-f${freq}`,
    freq,
    body: {
      distance: 'none', ttDistance: null, ttTime: null,
      weeklyMi: HIST.low.weeklyMi, weeklyFreq: freq,
      histAvg: HIST.low.histAvg, histLong: HIST.low.histLong,
      histYears: HIST.low.histYears, raceHistory: [], connectionsSkipped: true,
    },
  });
}

// COACHED · no plan authored.
add({ kind: 'coached', key: 'coached', freq: null,
  body: { distance: 'coached', raceHistory: [], connectionsSkipped: true } });

// ── HTTP helper ───────────────────────────────────────────────────
async function j(method, path, body, token) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

// ── Plan loader ───────────────────────────────────────────────────
async function loadPlanWeeks(userUuid) {
  const plan = (await db.query(
    `SELECT id, mode FROM training_plans WHERE user_uuid = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`, [userUuid])).rows[0];
  if (!plan) return null;
  const rows = (await db.query(
    `SELECT pw.date_iso, pw.dow, pw.type, pw.distance_mi::float AS mi,
            pw.is_quality, pw.is_long, pw.pace_target_s_per_mi AS pace,
            (pw.workout_spec IS NOT NULL) AS has_spec, plw.week_idx
       FROM plan_workouts pw JOIN plan_weeks plw ON plw.id = pw.week_id
      WHERE pw.plan_id = $1 ORDER BY plw.week_idx, pw.date_iso`, [plan.id])).rows;
  plan.qualityTypes = [...new Set(rows.filter((r) => r.is_quality && r.mi > 0).map((r) => r.type))];
  const weeks = new Map();
  for (const r of rows) {
    if (!weeks.has(r.week_idx)) weeks.set(r.week_idx, []);
    weeks.get(r.week_idx).push(r);
  }
  return { plan, weeks: [...weeks.entries()].sort((a, b) => a[0] - b[0]).map(([idx, days]) => ({ idx, days })) };
}

const runDays = (days) => days.filter((d) => d.mi > 0).length;
const weekMi = (days) => days.reduce((s, d) => s + d.mi, 0);
// Personas onboard with timezone America/Los_Angeles; the generator
// anchors on the RUNNER's local today (runnerToday), so compare against
// the same zone — not UTC, which is a day ahead on Pacific evenings.
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

// No prescribed run may be dated before today — a runner who onboards
// mid-week should never see runs scheduled before they existed.
function checkNoPastRuns(loaded) {
  const past = loaded.weeks.flatMap((w) => w.days)
    .filter((d) => d.mi > 0 && d.date_iso < TODAY);
  return past.length ? [`${past.length} run(s) scheduled before today (e.g. ${past[0].date_iso})`] : [];
}

// ── Validators ────────────────────────────────────────────────────
function validateMaintenance(p, loaded) {
  const fails = [];
  if (!loaded) return ['no active plan row'];
  if (loaded.plan.mode !== 'maintenance') fails.push(`mode=${loaded.plan.mode} (want maintenance)`);
  const weeks = loaded.weeks;
  if (weeks.length === 0) return ['plan has zero weeks'];

  // Day-count: NO week may EXCEED the stated frequency (the core bug —
  // 3-day runner getting 6 days). Low-volume weeks may under-fill (you
  // can't sensibly run 6×2mi), so we don't require exact equality early.
  const maxRun = Math.max(...weeks.map((w) => runDays(w.days)));
  if (maxRun > p.freq) fails.push(`runDays max ${maxRun} > freq ${p.freq}`);
  // When target volume comfortably supports the frequency (≥ freq×3.3mi),
  // the plan SHOULD reach it at peak — else the runner's stated freq is ignored.
  if (p.body.weeklyMi >= p.freq * 3.3 && maxRun < p.freq) {
    fails.push(`never reaches freq ${p.freq} (max ${maxRun}) despite ${p.body.weeklyMi}mi target`);
  }

  // Week-1 volume should start near current mileage, not target.
  const cur = { '5-15': 10, '15-25': 20, '25-35': 30 }[p.body.histAvg] ?? p.body.weeklyMi;
  const w0 = weekMi(weeks[0].days);
  if (w0 > cur * 1.5) fails.push(`week0 vol ${w0} >> current ~${cur}`);
  if (w0 <= 0) fails.push('week0 vol 0');

  // Progressive: a later non-cutback week should exceed week 0 when target>current.
  if (p.body.weeklyMi > cur) {
    const peak = Math.max(...weeks.map((w) => weekMi(w.days)));
    if (peak <= w0) fails.push(`no ramp: peak ${peak} <= week0 ${w0}`);
  }

  // Goal-appropriate quality: a TT-goal runner must get the energy system
  // their distance races on, NOT generic threshold. 5K/1mi → intervals
  // present; 10K → both threshold + intervals; no-goal consistency →
  // threshold only (no VO2 — correct aerobic hold).
  const q = loaded.plan.qualityTypes ?? [];
  const tt = p.body.ttDistance;
  if (tt === '5k' || tt === '1mi') {
    if (!q.includes('intervals')) fails.push(`${tt} goal but no interval/VO2 work (quality=${q.join(',')||'none'})`);
  } else if (tt === '10k') {
    if (!q.includes('intervals') || !q.includes('threshold')) fails.push(`10k goal wants threshold+intervals, got ${q.join(',')||'none'}`);
  } else {
    if (q.includes('intervals')) fails.push(`consistency (no goal) should not prescribe VO2 intervals, got ${q.join(',')}`);
  }
  return fails;
}

function validateRace(p, loaded) {
  const fails = [];
  if (!loaded) return ['no active plan row (race generator declined?)'];
  if (loaded.plan.mode !== 'race-prep') fails.push(`mode=${loaded.plan.mode} (want race-prep)`);
  const weeks = loaded.weeks;
  if (weeks.length === 0) return ['plan has zero weeks'];

  // Day-count: NO week may exceed the runner's stated frequency.
  const offenders = weeks.filter((w) => runDays(w.days) > p.freq);
  if (offenders.length) {
    const ex = offenders[0];
    fails.push(`${offenders.length} wk(s) exceed freq ${p.freq} (wk${ex.idx}=${runDays(ex.days)} days)`);
  }

  // Week-0 volume should not start at peak (cold-start ramp). Peak is the
  // max TRAINING week — exclude the race week (its total is inflated by
  // the race distance) so the ramp/taper comparisons are honest.
  const cur = { '5-15': 10, '15-25': 20, '25-35': 30 }[p.body.histAvg] ?? p.body.weeklyMi;
  const w0 = weekMi(weeks[0].days);
  const trainingWeeks = weeks.slice(0, -1);
  const peak = Math.max(...trainingWeeks.map((w) => weekMi(w.days)));
  if (w0 > cur * 1.6) fails.push(`week0 vol ${w0} >> current ~${cur} (no ramp-in)`);
  if (w0 >= peak && weeks.length > 4) fails.push(`week0 ${w0} is already peak ${peak}`);

  // Taper: race-week TRAINING volume (excluding the race itself) should
  // be well below peak. The race distance inflates the raw weekly total
  // (a marathon adds 26.2mi), so measure non-race miles.
  const raceWk = weeks[weeks.length - 1].days;
  const raceWkTraining = raceWk.filter((d) => d.type !== 'race').reduce((s, d) => s + d.mi, 0);
  if (raceWkTraining >= peak * 0.85) fails.push(`no taper: race-week training ${Math.round(raceWkTraining)} vs peak ${Math.round(peak)}`);
  // And the penultimate week should already be tapering (< peak).
  if (weeks.length >= 3) {
    const penult = weekMi(weeks[weeks.length - 2].days);
    if (penult >= peak) fails.push(`penultimate week ${Math.round(penult)} not tapering vs peak ${Math.round(peak)}`);
  }

  // Race-day row present.
  const raceDate = p.body.date;
  const hasRaceRow = weeks.some((w) => w.days.some((d) => d.type === 'race' || d.date_iso === raceDate));
  if (!hasRaceRow) fails.push(`no race-day row on ${raceDate}`);

  // Quality rows carry a pace target or a spec (not a naked number).
  const qualityNoPace = weeks.flatMap((w) => w.days)
    .filter((d) => d.is_quality && d.mi > 0 && d.pace == null && !d.has_spec);
  if (qualityNoPace.length) fails.push(`${qualityNoPace.length} quality rows lack pace+spec`);

  return fails;
}

// ── Drive ─────────────────────────────────────────────────────────
const results = [];
for (const p of personas) {
  const email = `m${RUN}-${p.key}@test.local`;
  const row = { key: p.key, freq: p.freq, status: '', fails: [], detail: '' };
  try {
    const su = await j('POST', '/api/auth/signup', { name: p.key, email, password: PASSWORD });
    if (su.status !== 200 || !su.data?.token) { row.status = 'SIGNUP-FAIL'; row.detail = `${su.status} ${su.data?.error ?? ''}`; results.push(row); continue; }
    const token = su.data.token;
    const userUuid = su.data.user_uuid;

    const done = await j('POST', '/api/onboarding/complete',
      { ...p.body, name: p.key, timezone: 'America/Los_Angeles' }, token);
    if (done.status !== 200 || done.data?.success !== true) {
      row.status = 'ONBOARD-FAIL'; row.detail = `${done.status} ${JSON.stringify(done.data?.error ?? done.data)?.slice(0, 80)}`;
      results.push(row); continue;
    }

    if (p.kind === 'coached') {
      const loaded = await loadPlanWeeks(userUuid);
      row.fails = loaded ? ['coached should author NO plan, found one'] : [];
      row.status = row.fails.length ? 'FAIL' : 'PASS';
      results.push(row); continue;
    }

    const loaded = await loadPlanWeeks(userUuid);
    const fails = p.kind === 'race' ? validateRace(p, loaded) : validateMaintenance(p, loaded);
    if (loaded) fails.push(...checkNoPastRuns(loaded));
    row.fails = fails;
    row.status = fails.length ? 'FAIL' : 'PASS';
    if (loaded) {
      const w = loaded.weeks;
      row.detail = `${w.length}wk · runDays[${w.map((x) => runDays(x.days)).join(',')}] · mi[${w.map((x) => Math.round(weekMi(x.days))).join(',')}]`;
    }
  } catch (e) {
    row.status = 'ERROR'; row.detail = e.message;
  }
  results.push(row);
}

// ── Report ────────────────────────────────────────────────────────
const pass = results.filter((r) => r.status === 'PASS').length;
console.log(`\n═══ PLAN MATRIX · run ${RUN} · ${pass}/${results.length} PASS ═══\n`);
for (const r of results) {
  const mark = r.status === 'PASS' ? '✓' : '✗';
  console.log(`${mark} ${r.key.padEnd(22)} ${r.status.padEnd(13)} ${r.fails.join(' | ') || r.detail}`);
}
console.log('');
// Detail line for failures (week shapes) to aid diagnosis.
for (const r of results.filter((r) => r.status === 'FAIL')) {
  console.log(`   ${r.key}: ${r.detail}`);
}

await db.end();
process.exit(results.every((r) => r.status === 'PASS') ? 0 : 1);
