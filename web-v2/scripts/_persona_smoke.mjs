// Persona smoke suite (David 2026-06-10: "smoke test on all possible
// runners. goals, someone who wants to just get faster at a 5k, has a
// coach, etc.") — drives the LOCAL dev server (prod DB) through every
// onboarding shape and asserts plan seeding + /today + watch payload.
// Requires ALLOW_OPEN_SIGNUP=true in .env.local (temporary, local only).
const BASE = 'http://localhost:3000';
// Optional run suffix (node _persona_smoke.mjs b) — fresh emails per run
// since signup 409s on existing accounts.
const SUFFIX = process.argv[2] ?? '';

const iso = (daysFromNow) => new Date(Date.now() + daysFromNow * 86400000).toISOString().slice(0, 10);

const PERSONAS = [
  {
    key: 'marathon-3:30', email: `faff-p1${SUFFIX}-marathon@example.com`, name: 'P1 Marathon',
    body: { distance: 'marathon', date: iso(16 * 7), time: '3:30:00', weeklyMi: 35, weeklyFreq: 5,
            histAvg: '25-35', histLong: '10+', histYears: '3-7', raceHistory: [], connectionsSkipped: true },
    expectPlan: (p) => p?.ok === true && p?.mode === 'race-prep' && (p?.weeks_generated ?? 0) >= 12,
    todayMarkers: ['DAYS TO GO'], todayAbsent: ['Novablast'],
  },
  {
    key: 'half-by-feel', email: `faff-p2${SUFFIX}-half@example.com`, name: 'P2 Half',
    body: { distance: 'half', date: iso(12 * 7), time: null, weeklyMi: 25, weeklyFreq: 4,
            histAvg: '15-25', histLong: '6-10', histYears: '1-3', raceHistory: [], connectionsSkipped: true },
    expectPlan: (p) => p?.ok === true && p?.mode === 'race-prep' && (p?.weeks_generated ?? 0) >= 10,
    todayMarkers: ['DAYS TO GO'], todayAbsent: [],
  },
  {
    key: '5k-pr', email: `faff-p3${SUFFIX}-5k@example.com`, name: 'P3 FiveK',
    body: { distance: '5k', date: iso(8 * 7), time: '21:30', weeklyMi: 25, weeklyFreq: 4,
            histAvg: '15-25', histLong: '6-10', histYears: '1-3', raceHistory: [], connectionsSkipped: true },
    expectPlan: (p) => p?.ok === true && p?.mode === 'race-prep' && (p?.weeks_generated ?? 0) >= 6,
    todayMarkers: ['DAYS TO GO'], todayAbsent: [],
  },
  {
    key: 'tt-5k-faster', email: `faff-p4${SUFFIX}-tt5k@example.com`, name: 'P4 TT FiveK',
    body: { distance: 'none', ttDistance: '5k', ttTime: '22-25', weeklyMi: 25, weeklyFreq: 4,
            histAvg: '15-25', histLong: '6-10', histYears: '1-3', raceHistory: [], connectionsSkipped: true },
    expectPlan: (p) => p?.ok === true && p?.mode === 'maintenance' && p?.weeks_generated === 16 && p?.peak_mpw === 25,
    todayMarkers: ['MAINTENANCE'], todayAbsent: [],
  },
  {
    key: 'consistency-beginner', email: `faff-p5${SUFFIX}-consistency@example.com`, name: 'P5 Consistency',
    body: { distance: 'none', ttDistance: null, ttTime: null, weeklyMi: 15, weeklyFreq: 3,
            histAvg: '5-15', histLong: '3-6', histYears: '<1', raceHistory: [], connectionsSkipped: true },
    expectPlan: (p) => p?.ok === true && p?.mode === 'maintenance' && p?.weeks_generated === 16,
    todayMarkers: ['MAINTENANCE'], todayAbsent: [],
  },
  {
    key: 'coached+calendar', email: `faff-p6${SUFFIX}-coached@example.com`, name: 'P6 Coached',
    body: { distance: 'coached', raceHistory: [], connectionsSkipped: true },
    expectPlan: (p) => p?.ok === true && p?.mode === 'coached' && p?.plan_id == null,
    calendar: 'http://localhost:4060/coach.ics',
    todayMarkers: ['COACHED', 'FROM YOUR COACH'], todayAbsent: ['MISSED', 'TARGET PACE'],
  },
  {
    key: '10k-short-runway', email: `faff-p7${SUFFIX}-runway@example.com`, name: 'P7 Runway',
    body: { distance: '10k', date: iso(10), time: '45:00', raceHistory: [], connectionsSkipped: true },
    // Generator declines edge runways by contract — race row stands, plan absent.
    expectPlan: (p) => p?.mode === 'race-prep' && (p?.ok === true || typeof p?.error === 'string'),
    todayMarkers: [], todayAbsent: [], allowPlanFail: true,
  },
];

const strip = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

async function j(method, path, body, token) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

const results = [];
for (const p of PERSONAS) {
  const row = { persona: p.key, signup: '·', plan: '·', today: '·', watch: '·', notes: [] };
  try {
    // 1 · account (timezone-stable common fields appended at complete)
    const su = await j('POST', '/api/auth/signup', { name: p.name, email: p.email, password: 'persona-9281' });
    row.signup = su.status === 200 ? 'PASS' : `FAIL ${su.status} ${su.data?.error ?? ''}`;
    if (su.status !== 200) { results.push(row); continue; }
    const token = su.data.token;

    // 2 · onboarding completion
    const done = await j('POST', '/api/onboarding/complete', {
      ...p.body, name: p.name, timezone: 'America/Los_Angeles',
    }, token);
    const plan = done.data?.plan ?? null;
    const planOk = done.status === 200 && done.data?.success === true && p.expectPlan(plan);
    row.plan = planOk ? `PASS (${plan?.mode}${plan?.weeks_generated ? ` · ${plan.weeks_generated}wk` : ''}${plan?.peak_mpw ? ` · ${plan.peak_mpw}mpw` : ''}${plan?.ok === false ? ` · declined: ${plan.error?.slice(0, 40)}` : ''})` : `FAIL ${JSON.stringify(plan)?.slice(0, 120)}`;

    // 2b · coached calendar hookup
    if (p.calendar) {
      const cal = await j('POST', '/api/coach-calendar', { url: p.calendar }, token);
      if (!(cal.status === 200 && cal.data?.events_total >= 1)) {
        row.notes.push(`calendar FAIL ${cal.status} ${cal.data?.error ?? ''}`);
      }
    }

    // 3 · /today SSR render
    const tr = await fetch(BASE + '/today', { headers: { cookie: `faff_session=${token}` } });
    const text = strip(await tr.text());
    const missing = p.todayMarkers.filter((m) => !text.includes(m));
    const leaked = p.todayAbsent.filter((m) => text.includes(m));
    row.today = tr.status === 200 && missing.length === 0 && leaked.length === 0
      ? 'PASS'
      : `FAIL ${tr.status}${missing.length ? ' missing:' + missing.join('/') : ''}${leaked.length ? ' leaked:' + leaked.join('/') : ''}`;

    // 4 · watch payload shape
    const w = await j('GET', '/api/watch/today', null, token);
    const shapeOk = w.status === 200 && (w.data?.workout != null || typeof w.data?.message === 'string');
    row.watch = shapeOk ? `PASS (${w.data?.workout ? w.data.workout.type ?? 'workout' : w.data?.message})` : `FAIL ${w.status}`;
  } catch (e) {
    row.notes.push(`threw: ${e.message}`);
  }
  results.push(row);
}

console.log('\nPERSONA SMOKE RESULTS');
for (const r of results) {
  console.log(`  ${r.persona.padEnd(22)} signup:${r.signup}  plan:${r.plan}  today:${r.today}  watch:${r.watch}${r.notes.length ? '  notes: ' + r.notes.join(' | ') : ''}`);
}
const failed = results.filter((r) => [r.signup, r.plan, r.today, r.watch].some((v) => String(v).startsWith('FAIL')) || r.notes.length);
console.log(failed.length ? `\n${failed.length} persona(s) with failures` : '\nALL PERSONAS PASS');
process.exit(failed.length ? 1 : 0);
