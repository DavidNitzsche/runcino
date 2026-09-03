// ════════════════════════════════════════════════════════════════════════
// ROUND-2 GAP · POST-COMPOSE MUTATION BLOCK (generate.ts ~2230-2320)
// ════════════════════════════════════════════════════════════════════════
// Round 1's offline sweeps checked composePlan's pre-mutation output. They
// NEVER checked the PERSISTED plan_workouts — what the runner actually gets.
//
// The persisted distance is NOT d.distanceMi. persistPlan stores
// totalDistanceMiFromSpec(spec, d.distanceMi) for quality rows (WU + core +
// CD + float-jog recovery). The post-compose mutation block (long WoW
// smoother → taper rescale → re-smooth → easy/quality<=long sweep) clamps
// d.distanceMi BEFORE this spec expansion. So a quality day clamped to == long
// at compose can persist ABOVE long once float-recovery miles are added.
//
// This harness drives the LIVE prod API with ONE test user, re-onboarding it
// per profile, then sets a goal / adds a race, pulls the ACTUAL post-mutation
// plan_workouts ROW-BY-ROW, and re-checks invariants 2,3,4,5,6,7,8,9,13 on
// the realized rows — plus available_days (8) and race-week frequency (9)
// which round 1 never set, and planned-vs-realized divergence.
//
// Run SERIALLY (one shared test user). Never touches any non-test user.
//   node scripts/_audit_postcompose.mjs
//   node scripts/_audit_postcompose.mjs --quick     (smaller matrix)
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
const QUICK = process.argv.includes('--quick');

const DBURL = (process.env.DATABASE_URL_RO
  || fs.readFileSync('.env.local', 'utf8').split('\n')
      .find((l) => l.startsWith('DATABASE_URL='))?.slice('DATABASE_URL='.length)) ?? '';
const db = new pg.Client({ connectionString: DBURL.trim() });
await db.connect();

// Safety rail: confirm the test user uuid up front; every DB write is scoped to it.
const TEST_UUID = (await db.query('SELECT id FROM users WHERE email=$1', [EMAIL])).rows[0]?.id;
if (!TEST_UUID) { console.error('FATAL: test user not found'); process.exit(2); }
console.log(`test user uuid = ${TEST_UUID}\n`);

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
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  try { return JSON.parse(txt); } catch { return { _status: r.status, _raw: txt.slice(0, 200) }; }
}

// ── volume tiers (weeklyMi + matching history bands) ───────────────────
const VOL = {
  zero: { weeklyMi: 0,  histAvg: '0-5',   histLong: '0-3' },
  lo:   { weeklyMi: 5,  histAvg: '0-5',   histLong: '0-3' },
  low:  { weeklyMi: 15, histAvg: '5-15',  histLong: '3-6' },
  mid:  { weeklyMi: 25, histAvg: '15-25', histLong: '6-10' },
  hi:   { weeklyMi: 35, histAvg: '25-35', histLong: '10+' },
  peak: { weeklyMi: 45, histAvg: '35+',   histLong: '10+' },
};
const GOAL_TIME = {
  '5K': '24:00', '10K': '50:00', 'Half Marathon': '1:50:00',
  'Marathon': '3:55:00', '50K': '5:30:00', '100K': '12:00:00',
};
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DOW_NAME = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── the matrix ─────────────────────────────────────────────────────────
const cases = [];
const add = (label, profile, target) => cases.push({ label, profile, target });

// 1. Frequency sweep 1-6 with available_days SHAPES (round 1 never set avail).
//    The available_days set is sized to the frequency so the cap + placement
//    interact (this is where race-week freq + avail were never exercised).
const AVAIL_BY_FREQ = {
  1: ['sun'],                                  // <2 → route drops it (cap still applies)
  2: ['tue', 'sun'],
  3: ['tue', 'thu', 'sun'],
  4: ['mon', 'wed', 'fri', 'sun'],
  5: ['mon', 'tue', 'thu', 'fri', 'sun'],
  6: ['mon', 'tue', 'wed', 'thu', 'fri', 'sun'],
};
for (const f of (QUICK ? [2, 3, 5] : [1, 2, 3, 4, 5, 6])) {
  add(`freq${f}+avail·intermediate·mid·HM`,
    { experienceLevel: 'intermediate', weeklyFreq: f, ...VOL.mid },
    { goal: 'Half Marathon', available: AVAIL_BY_FREQ[f], weeks: 12 });
  if (!QUICK) add(`freq${f}+avail·beginner·low·10K`,
    { experienceLevel: 'beginner', weeklyFreq: f, ...VOL.low },
    { goal: '10K', available: AVAIL_BY_FREQ[f], weeks: 10 });
}

// 2. Experience × volume × distance grid (the post-mutation taper + WoW edges).
const LEVELS = QUICK ? ['beginner', 'advanced'] : ['beginner', 'intermediate', 'advanced', 'advanced_plus'];
const VOLS = QUICK ? ['low', 'hi'] : ['lo', 'low', 'mid', 'hi'];
const DISTS = QUICK ? ['5K', 'Marathon'] : ['5K', '10K', 'Half Marathon', 'Marathon'];
for (const exp of LEVELS) {
  for (const v of VOLS) {
    for (const d of DISTS) {
      // freq 4, no avail constraint here — isolate the volume/distance/taper math.
      add(`${exp}·${v}·${d}`,
        { experienceLevel: exp, weeklyFreq: 4, ...VOL[v] },
        { goal: d, weeks: 14 });
    }
  }
}

// 3. PROTECTED persona · advanced/advanced_plus MARATHON (invariant 12) — pulled
//    out explicitly at a realistic peak base so any drift is loud.
add('PROTECTED·advanced·marathon·hi',
  { experienceLevel: 'advanced', weeklyFreq: 5, ...VOL.hi }, { goal: 'Marathon', weeks: 16 });
add('PROTECTED·advanced_plus·marathon·peak',
  { experienceLevel: 'advanced_plus', weeklyFreq: 6, ...VOL.peak }, { goal: 'Marathon', weeks: 18 });

// 4. Ultra (taper-rescale ultra branch · invariant 6 with ultra drop floor).
if (!QUICK) {
  add('ultra·intermediate·hi·50K', { experienceLevel: 'intermediate', weeklyFreq: 5, ...VOL.hi }, { goal: '50K', weeks: 18 });
  add('ultra·advanced·peak·100K', { experienceLevel: 'advanced', weeklyFreq: 6, ...VOL.peak }, { goal: '100K', weeks: 20 });
}

// 5. Plan-week edges 4 / 16 / 52 (totalWeeks span — taper + ramp at extremes).
add('weeks4·HM·intermediate·mid', { experienceLevel: 'intermediate', weeklyFreq: 4, ...VOL.mid }, { goal: 'Half Marathon', weeks: 4 });
add('weeks16·Marathon·intermediate·hi', { experienceLevel: 'intermediate', weeklyFreq: 5, ...VOL.hi }, { goal: 'Marathon', weeks: 16 });
add('weeks52·Marathon·advanced·hi', { experienceLevel: 'advanced', weeklyFreq: 5, ...VOL.hi }, { goal: 'Marathon', weeks: 52 });
if (!QUICK) {
  add('weeks4·5K·beginner·lo', { experienceLevel: 'beginner', weeklyFreq: 3, ...VOL.lo }, { goal: '5K', weeks: 4 });
  add('weeks52·HM·beginner·low', { experienceLevel: 'beginner', weeklyFreq: 3, ...VOL.low }, { goal: 'Half Marathon', weeks: 52 });
}

// 6. Over-volumed-for-goal (peak <= stated volume → flat ramp OK · invariant 5
//    exemption must hold on the realized rows too).
add('overvol·advanced·peak·5K', { experienceLevel: 'advanced', weeklyFreq: 6, ...VOL.peak }, { goal: '5K', weeks: 12 });
add('overvol·intermediate·hi·10K', { experienceLevel: 'intermediate', weeklyFreq: 5, ...VOL.hi }, { goal: '10K', weeks: 12 });

// 7. RACE PATH (the OTHER persistence path — race-prep via /api/race) with
//    available_days set, across runways/start offsets. Round 1 ran 3 race
//    cases with NO avail; race-week avail+freq on persisted rows = pure gap.
add('race·HM·intermediate·mid·avail4·d112',
  { experienceLevel: 'intermediate', weeklyFreq: 4, ...VOL.mid },
  { race: 'Half Marathon', raceInDays: 112, available: ['mon', 'wed', 'fri', 'sun'] });
add('race·Marathon·advanced·hi·avail5·d140',
  { experienceLevel: 'advanced', weeklyFreq: 5, ...VOL.hi },
  { race: 'Marathon', raceInDays: 140, available: ['mon', 'tue', 'thu', 'fri', 'sun'] });
add('race·5K·beginner·lo·avail2·d70·start+10',
  { experienceLevel: 'beginner', weeklyFreq: 2, ...VOL.lo },
  { race: '5K', raceInDays: 70, available: ['tue', 'sun'], startInDays: 10 });
if (!QUICK) {
  add('race·10K·intermediate·mid·avail3·d84',
    { experienceLevel: 'intermediate', weeklyFreq: 3, ...VOL.mid },
    { race: '10K', raceInDays: 84, available: ['tue', 'thu', 'sat'] });
  // freq1 race week: cap → race only. freq2 → race + shakeout (fix d).
  add('race·HM·intermediate·mid·freq1·d98',
    { experienceLevel: 'intermediate', weeklyFreq: 1, ...VOL.mid },
    { race: 'Half Marathon', raceInDays: 98 });
  add('race·HM·intermediate·mid·freq2·d98',
    { experienceLevel: 'intermediate', weeklyFreq: 2, ...VOL.mid },
    { race: 'Half Marathon', raceInDays: 98 });
}

// 8. Fix (a) re-verify · marathon goal, ~17wk runway, start today+1 (the exact
//    dead-end shape). MUST generate (>0 plans) AND surface plan_error on fail.
add('FIX-a·marathon·17wk·start+1',
  { experienceLevel: 'intermediate', weeklyFreq: 5, ...VOL.hi },
  { goal: 'Marathon', weeks: 17, startInDays: 1 });

// ════════════════════════════════════════════════════════════════════════
// POST-MUTATION INVARIANT CHECKS (on the realized plan_workouts rows)
// ════════════════════════════════════════════════════════════════════════
async function checkPersistedPlan(planId, c) {
  const fails = [];
  // ROW-LEVEL pull (not week-max) so per-day invariants are exact.
  const { rows } = await db.query(
    `SELECT pw.week_id, pw.date_iso, pw.dow, pw.type, pw.is_long, pw.is_quality,
            pw.distance_mi::float AS dist, pw.pace_target_s_per_mi AS pace,
            (pw.workout_spec IS NOT NULL) AS has_spec,
            pwk.week_idx, pwk.is_race_week, pwk.phase_id, pwk.is_cutback, pwk.is_peak
       FROM plan_workouts pw
       JOIN plan_weeks pwk ON pwk.id = pw.week_id
      WHERE pw.plan_id = $1
      ORDER BY pwk.week_idx, pw.dow`,
    [planId],
  );
  if (rows.length === 0) { fails.push({ inv: 1, msg: 'no plan_workouts rows persisted' }); return fails; }

  // Group by week.
  const byWeek = new Map();
  for (const r of rows) {
    if (!byWeek.has(r.week_idx)) byWeek.set(r.week_idx, []);
    byWeek.get(r.week_idx).push(r);
  }
  const weekIdxs = [...byWeek.keys()].sort((a, b) => a - b);
  const nWeeks = weekIdxs.length;

  const availSet = c.target.available && c.target.available.length >= 2
    ? new Set(c.target.available.map((d) => DAY_KEYS.indexOf(d))) : null;
  const statedFreq = c.profile.weeklyFreq;
  const statedVol = c.profile.weeklyMi ?? 0;
  // The race/deadline day exemption: dow of the last week's longest/race day.
  // We exempt the race-day row explicitly via type/is_long below.

  const weekRealizedTotals = [];
  const longByWeek = [];

  for (const wi of weekIdxs) {
    const wk = byWeek.get(wi);
    const wkNo = wi + 1;
    const isRaceWeek = wk.some((r) => r.is_race_week);
    // running rows = labeled running days with positive distance (exclude
    // strength/cross/rest).
    const runRows = wk.filter((r) => r.dist > 0 && !['strength', 'cross', 'rest'].includes(r.type));
    const raceRow = wk.find((r) => r.type === 'race');
    // ── INV 13 · no NaN/null/negative/non-positive on a labeled running day ──
    for (const r of wk) {
      const isRunningLabel = !['rest', 'strength', 'cross'].includes(r.type);
      if (isRunningLabel) {
        if (r.dist == null || Number.isNaN(r.dist)) fails.push({ inv: 13, msg: `wk${wkNo} ${r.type} ${r.date_iso}: distance null/NaN` });
        else if (r.dist <= 0) fails.push({ inv: 13, msg: `wk${wkNo} ${r.type} ${r.date_iso}: distance ${r.dist} (non-positive on running day)` });
        else if (r.dist < 0) fails.push({ inv: 13, msg: `wk${wkNo} ${r.type} ${r.date_iso}: NEGATIVE distance ${r.dist}` });
      }
    }
    // ── INV 2 · exactly 7 contiguous days, one primary workout/day ──
    const dates = [...new Set(wk.map((r) => r.date_iso))].sort();
    if (dates.length !== 7) fails.push({ inv: 2, msg: `wk${wkNo}: ${dates.length} distinct days (not 7) [${dates.join(',')}]` });
    else {
      // contiguity: each consecutive date is +1 day.
      for (let i = 1; i < dates.length; i++) {
        const gap = Math.round((Date.parse(dates[i] + 'T12:00:00Z') - Date.parse(dates[i - 1] + 'T12:00:00Z')) / 86400000);
        if (gap !== 1) fails.push({ inv: 2, msg: `wk${wkNo}: non-contiguous ${dates[i - 1]}→${dates[i]} (gap ${gap}d)` });
      }
    }
    // one PRIMARY (running) workout per day: a date with >1 running row is a dup.
    const runByDate = {};
    for (const r of runRows) runByDate[r.date_iso] = (runByDate[r.date_iso] ?? 0) + 1;
    for (const [d, n] of Object.entries(runByDate)) if (n > 1) fails.push({ inv: 2, msg: `wk${wkNo}: ${n} running rows on ${d} (expect 1 primary)` });

    // ── realized long (excl race-day) + week training total ──
    const trainingLong = Math.max(0, ...wk.filter((r) => r.is_long && r.type !== 'race').map((r) => r.dist));
    // longest run INCLUDING race day (for the easy/quality <= long check in a
    // short-race week the race itself is the longest run).
    const longestInclRace = Math.max(0, ...wk.filter((r) => r.is_long).map((r) => r.dist));
    longByWeek.push({ wkNo, trainingLong, isRaceWeek, isCutback: wk.some((r) => r.is_cutback) });
    const weekTrainingTotal = wk.filter((r) => r.type !== 'race').reduce((s, r) => s + (r.dist || 0), 0);
    const weekTotalInclRace = wk.reduce((s, r) => s + (r.dist || 0), 0);
    weekRealizedTotals.push({ wkNo, weekTrainingTotal, weekTotalInclRace, isRaceWeek });

    // ── INV 3 · long >= every easy AND >= every quality (race day exempt) ──
    if (longestInclRace > 0) {
      for (const r of wk) {
        if (r.type === 'race' || r.is_long) continue;       // race + the long itself exempt
        if (r.type === 'easy' && r.dist > longestInclRace + 0.05)
          fails.push({ inv: 3, msg: `wk${wkNo}: EASY ${r.dist} > long ${longestInclRace} (${r.date_iso}) [persisted/realized]` });
        if (r.is_quality && r.dist > longestInclRace + 0.05)
          fails.push({ inv: 3, msg: `wk${wkNo}: QUALITY ${r.dist} > long ${longestInclRace} (${r.type} ${r.date_iso}) [persisted/realized — spec-expansion leak?]` });
      }
    }
    // ── INV 4 · quality <= 1.5×long AND <= 0.6×week (no dwarf) ──
    // Applied per quality row against the TRAINING long (not race day) + week
    // training total. Skip pure race-week (shakeout is tiny anyway).
    if (!isRaceWeek && trainingLong > 0) {
      const ceil = Math.max(trainingLong * 1.5, weekTrainingTotal * 0.6);
      for (const r of wk.filter((x) => x.is_quality && x.type !== 'race')) {
        if (r.dist > ceil + 0.1)
          fails.push({ inv: 4, msg: `wk${wkNo}: QUALITY ${r.dist} dwarfs (1.5×long=${(trainingLong * 1.5).toFixed(1)}, 0.6×wk=${(weekTrainingTotal * 0.6).toFixed(1)}) [${r.type} ${r.date_iso}]` });
      }
    }
    // ── INV 7 · every quality row has a pace target AND a workout spec ──
    for (const r of wk.filter((x) => x.is_quality && x.dist > 0 && x.type !== 'race')) {
      if (r.pace == null || !r.has_spec)
        fails.push({ inv: 7, msg: `wk${wkNo}: quality ${r.type} ${r.date_iso} missing ${r.pace == null ? 'pace ' : ''}${!r.has_spec ? 'spec' : ''}` });
    }
    // ── INV 8 · available_days respected (running days ⊆ available; race/
    //    deadline day exempt) — INCLUDING the race week ──
    if (availSet) {
      for (const r of runRows) {
        const exempt = r.type === 'race' || (isRaceWeek && r.is_long);
        if (!exempt && !availSet.has(r.dow))
          fails.push({ inv: 8, msg: `wk${wkNo}${isRaceWeek ? ' (RACE WK)' : ''}: ${r.type} on ${DOW_NAME[r.dow]} not in available {${[...availSet].map((d) => DOW_NAME[d]).join(',')}} (${r.date_iso})` });
      }
    }
    // ── INV 9 · frequency cap (running days <= stated freq) — INCLUDING race wk ──
    if (statedFreq != null && statedFreq >= 1) {
      // race day counts as a running day. The race-week cap (fix d): freq1 →
      // race only (1 running day), freq2 → race + shakeout (<=2).
      const nRun = runRows.length;
      if (nRun > statedFreq)
        fails.push({ inv: 9, msg: `wk${wkNo}${isRaceWeek ? ' (RACE WK)' : ''}: ${nRun} running days > stated freq ${statedFreq} [${runRows.map((r) => DOW_NAME[r.dow]).join(',')}]` });
    }
  }

  // ── INV 6 · real taper (race/final week TRAINING < peak) ──
  // peak = max non-race-week training total.
  const nonRaceTotals = weekRealizedTotals.filter((w) => !w.isRaceWeek).map((w) => w.weekTrainingTotal);
  const peakTrain = Math.max(0, ...nonRaceTotals);
  const finalWk = weekRealizedTotals[weekRealizedTotals.length - 1];
  if (nWeeks > 4 && peakTrain > 0) {
    // race-prep taper: the final (race) week training must be meaningfully below peak.
    if (finalWk.weekTrainingTotal >= peakTrain * 0.9)
      fails.push({ inv: 6, msg: `final wk${finalWk.wkNo} training ${finalWk.weekTrainingTotal.toFixed(1)} ~ peak ${peakTrain.toFixed(1)} (no real taper)` });
  }

  // ── INV 5 · progressive ramp (wk0 < peak) UNLESS over-volumed-for-goal ──
  if (nWeeks > 4) {
    const wk0Train = weekRealizedTotals[0].weekTrainingTotal;
    const overVolumed = peakTrain <= statedVol; // peak already <= what they do → flat OK
    if (!overVolumed && wk0Train >= peakTrain - 0.05)
      fails.push({ inv: 5, msg: `no ramp: wk0 ${wk0Train.toFixed(1)} >= peak ${peakTrain.toFixed(1)} (statedVol ${statedVol})` });
  }

  // ── Long-run WoW jump >30% must NOT survive on the realized longs ──
  // (the smoother runs on d.distanceMi; verify the persisted longs hold the
  // rule. race-day excluded — trainingLong already excludes it.)
  for (let i = 1; i < longByWeek.length; i++) {
    const prev = longByWeek[i - 1].trainingLong;
    const curr = longByWeek[i].trainingLong;
    if (prev > 0 && curr > prev * 1.30 + 0.051) {
      const pct = Math.round(((curr - prev) / prev) * 100);
      fails.push({ inv: '3/WoW', msg: `wk${longByWeek[i].wkNo}: long jump ${prev}→${curr} (${pct}% > 30%) [persisted]` });
    }
  }

  // ── Planned-vs-realized divergence sanity ──
  // Every realized week training total must be a finite, sane number and the
  // long must actually be the largest training run in the realized rows.
  for (const wt of weekRealizedTotals) {
    if (!(wt.weekTrainingTotal >= 0) || !Number.isFinite(wt.weekTrainingTotal))
      fails.push({ inv: 13, msg: `wk${wt.wkNo}: realized training total ${wt.weekTrainingTotal} not finite/>=0` });
  }

  return fails;
}

// ── per-case driver ──────────────────────────────────────────────────────
async function archiveActive() {
  await db.query(
    `UPDATE training_plans SET archived_iso=NOW() WHERE user_uuid=$1 AND archived_iso IS NULL`,
    [TEST_UUID],
  ).catch(() => {});
}
// Reset available_days between cases so a prior case's set doesn't leak into a
// case that intends NO constraint. (user_settings is a jsonb; remove the key.)
async function clearAvailableDays() {
  await db.query(
    `UPDATE profile SET user_settings = user_settings - 'available_days' WHERE user_uuid=$1`,
    [TEST_UUID],
  ).catch(() => {});
}

await signIn();
const results = [];
let n = 0;
for (const c of cases) {
  n++;
  let planId = null, genErr = null, extraNote = '';
  try {
    await clearAvailableDays();
    await archiveActive();
    // Re-onboard with the persona (no race in onboarding — goal/race set after).
    const ob = await api('/api/onboarding/complete', {
      distance: 'none', longRunDay: 'sun', name: 'PCAudit', timezone: 'America/Los_Angeles',
      raceHistory: [], connectionsSkipped: true, ...c.profile,
    });
    if (ob?.error) genErr = `onboard: ${ob.error}`;

    if (!genErr && c.target.goal) {
      const body = {
        distance_label: c.target.goal, goal_time: GOAL_TIME[c.target.goal],
        plan_weeks: c.target.weeks ?? 12, start_date: iso(c.target.startInDays ?? 1),
      };
      if (c.target.available) body.available_days = c.target.available;
      const r = await api('/api/profile/goal', body);
      planId = r?.plan?.plan_id ?? null;
      if (!planId) genErr = `plan null (plan_error=${r?.plan_error ?? r?._status ?? 'unknown'})`;
      else if (r?.plan_error) extraNote = `plan_error set but plan present: ${r.plan_error}`;
    } else if (!genErr && c.target.race) {
      await archiveActive(); // /api/race only generates with NO active plan
      const body = {
        name: `PCAudit ${c.target.race}`, date: iso(c.target.raceInDays),
        distance_label: c.target.race, priority: 'A',
      };
      if (c.target.startInDays != null) body.start_date = iso(c.target.startInDays);
      if (c.target.available) body.available_days = c.target.available;
      const r = await api('/api/race', body);
      planId = r?.plan?.plan_id ?? null;
      if (!planId) genErr = `plan null (${r?.plan?.reason ?? r?.error ?? r?._status ?? 'no plan'})`;
    }

    let fails = [];
    if (genErr) fails = [{ inv: 1, msg: genErr }];
    else fails = await checkPersistedPlan(planId, c);
    if (extraNote) fails.push({ inv: 'note', msg: extraNote });

    const ok = fails.filter((f) => f.inv !== 'note').length === 0;
    results.push({ label: c.label, ok, fails, planId });
    process.stdout.write(`[${n}/${cases.length}] ${ok ? 'PASS' : 'FAIL'} ${c.label}` +
      (ok ? '\n' : '\n      ' + fails.map((f) => `inv${f.inv}: ${f.msg}`).join('\n      ') + '\n'));
  } catch (e) {
    results.push({ label: c.label, ok: false, fails: [{ inv: 'EXC', msg: e.message }] });
    process.stdout.write(`[${n}/${cases.length}] ERR  ${c.label} → ${e.message}\n`);
  }
}

// ── summary ────────────────────────────────────────────────────────────
const passed = results.filter((r) => r.ok).length;
console.log(`\n========== ${passed}/${results.length} PASS  (combos tested: ${results.length}) ==========`);
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log('\nFAILURES (by invariant):');
  for (const r of failed) {
    console.log(`  ✗ ${r.label}  [plan_id=${r.planId ?? 'none'}]`);
    for (const f of r.fails) console.log(`      inv${f.inv}: ${f.msg}`);
  }
}
// Machine-readable block for the report.
console.log('\n---JSON---');
console.log(JSON.stringify({
  combosTested: results.length,
  passed,
  failed: failed.map((r) => ({ label: r.label, planId: r.planId, fails: r.fails })),
}, null, 0));

await db.end();
process.exit(failed.length ? 1 : 0);
