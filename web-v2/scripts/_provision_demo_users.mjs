// Provision a clean, clearly-named set of demo users in the sandbox —
// one per meaningful onboarding path/option, each fully onboarded with a
// real plan, plus fake goals/races. David logs in to see each populated.
// Password for ALL: faff-test.   node scripts/_provision_demo_users.mjs

import pg from 'pg';

const BASE = 'http://localhost:3100';
const DB = 'postgresql://localhost:5432/faff_sandbox';
const PASSWORD = 'faff-test';
const db = new pg.Client({ connectionString: DB });
await db.connect();

const iso = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

// Curated demo roster · descriptive emails, varied frequencies + states.
const DEMO = [
  { email: 'demo-marathon@test.local', name: 'Demo · Marathon (4d, goal 3:45)',
    body: { distance: 'marathon', date: iso(14 * 7), time: '3:45:00', weeklyMi: 35, weeklyFreq: 4, histAvg: '25-35', histLong: '10+', histYears: '3-7' } },
  { email: 'demo-half@test.local', name: 'Demo · Half (3d, first race)',
    body: { distance: 'half', date: iso(11 * 7), time: null, weeklyMi: 25, weeklyFreq: 3, histAvg: '15-25', histLong: '6-10', histYears: '1-3' } },
  { email: 'demo-10k@test.local', name: 'Demo · 10K (5d, goal 45:00)',
    body: { distance: '10k', date: iso(9 * 7), time: '45:00', weeklyMi: 35, weeklyFreq: 5, histAvg: '25-35', histLong: '6-10', histYears: '3-7' } },
  { email: 'demo-5k@test.local', name: 'Demo · 5K (3d, goal 21:30)',
    body: { distance: '5k', date: iso(8 * 7), time: '21:30', weeklyMi: 20, weeklyFreq: 3, histAvg: '15-25', histLong: '3-6', histYears: '1-3' } },
  { email: 'demo-marathon-6d@test.local', name: 'Demo · Marathon (6d, high vol)',
    body: { distance: 'marathon', date: iso(16 * 7), time: '3:10:00', weeklyMi: 55, weeklyFreq: 6, histAvg: '35+', histLong: '10+', histYears: '7+' } },
  { email: 'demo-faster-5k@test.local', name: 'Demo · Get faster at 5K (4d)',
    body: { distance: 'none', ttDistance: '5k', ttTime: '22-25', weeklyMi: 25, weeklyFreq: 4, histAvg: '15-25', histLong: '6-10', histYears: '1-3' } },
  { email: 'demo-faster-mile@test.local', name: 'Demo · Get faster at 1mi (3d)',
    body: { distance: 'none', ttDistance: '1mi', ttTime: '6:00-7:00', weeklyMi: 15, weeklyFreq: 3, histAvg: '5-15', histLong: '3-6', histYears: '1-3' } },
  { email: 'demo-consistency@test.local', name: 'Demo · Just run (3d, beginner)',
    body: { distance: 'none', ttDistance: null, ttTime: null, weeklyMi: 15, weeklyFreq: 3, histAvg: '5-15', histLong: '3-6', histYears: '<1' } },
  { email: 'demo-coached@test.local', name: 'Demo · External coach',
    body: { distance: 'coached' } },
  { email: 'demo-marathon-faraway@test.local', name: 'Demo · Marathon 6mo out (maintenance)',
    body: { distance: 'marathon', date: iso(26 * 7), time: '3:30:00', weeklyMi: 35, weeklyFreq: 4, histAvg: '25-35', histLong: '10+', histYears: '3-7' } },
];

async function j(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

// Clean slate for the demo emails so re-runs are idempotent.
const emails = DEMO.map((d) => d.email);
const ids = (await db.query(`SELECT id FROM users WHERE email = ANY($1)`, [emails])).rows.map((r) => r.id);
if (ids.length) {
  for (const t of ['plan_workouts', 'plan_weeks', 'plan_phases', 'training_plans', 'races', 'profile', 'user_prefs', 'sessions']) {
    await db.query(`DELETE FROM ${t} WHERE user_uuid = ANY($1)`, [ids]).catch(() => {});
  }
  await db.query(`DELETE FROM users WHERE id = ANY($1)`, [ids]).catch(() => {});
}

const out = [];
for (const d of DEMO) {
  const su = await j('POST', '/api/auth/signup', { name: d.name, email: d.email, password: PASSWORD });
  if (su.status !== 200) { out.push({ email: d.email, state: `SIGNUP FAIL ${su.status}` }); continue; }
  const token = su.data.token;
  const done = await j('POST', '/api/onboarding/complete', { ...d.body, name: d.name, timezone: 'America/Los_Angeles', connectionsSkipped: true }, token);
  const plan = done.data?.plan;
  // Plan shape summary from DB.
  let shape = '';
  const tp = (await db.query(`SELECT id, mode FROM training_plans WHERE user_uuid=$1 AND archived_iso IS NULL ORDER BY authored_iso DESC LIMIT 1`, [su.data.user_uuid])).rows[0];
  if (tp) {
    const wk = (await db.query(`SELECT plw.week_idx, count(*) FILTER (WHERE pw.distance_mi>0) AS rd, round(sum(pw.distance_mi)) AS mi
      FROM plan_workouts pw JOIN plan_weeks plw ON plw.id=pw.week_id WHERE pw.plan_id=$1 GROUP BY plw.week_idx ORDER BY plw.week_idx`, [tp.id])).rows;
    shape = `${tp.mode} · ${wk.length}wk · ${wk[0]?.rd ?? 0}–${Math.max(...wk.map(w=>+w.rd))} run-days/wk`;
  } else {
    shape = plan?.mode === 'coached' ? 'coached · no plan (by design)' : 'no plan';
  }
  out.push({ email: d.email, state: done.data?.success ? 'OK' : `FAIL`, shape });
}

console.log('\n═══ DEMO USERS · password: faff-test ═══\n');
for (const r of out) console.log(`${r.state === 'OK' ? '✓' : '✗'} ${r.email.padEnd(36)} ${r.shape ?? r.state}`);

// Also list the un-onboarded fresh-onboarding accounts.
const fresh = (await db.query(`SELECT email FROM users WHERE email LIKE 'runner-%@test.local' AND onboarding_complete=false ORDER BY email`)).rows.map(r=>r.email);
console.log('\n── Un-onboarded (log in to experience onboarding fresh) ──');
for (const e of fresh) console.log(`  ${e}`);
console.log('');
await db.end();
