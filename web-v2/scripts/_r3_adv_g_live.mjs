#!/usr/bin/env node
/**
 * R3 ADVERSARIAL repro of g-persist-quality-over-long, LIVE on prod.
 * Exactly the auditor's scenario: intermediate, 5k, weeklyMi=25, goal 18:30,
 * plan_weeks 9, freq 3 AND freq 4. Read PERSISTED plan_workouts and compare
 * each quality row's distance_mi to its OWN week's long distance_mi.
 *
 * SERIAL, test user only. Reads RO DB.
 */
import pg from 'pg';
import { readFileSync } from 'fs';

const BASE = 'https://www.faff.run';
const EMAIL = 'test-onboarding@faff.run';
const PASSWORD = 'Faff2026!';
const RO_URL = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  .match(/^DATABASE_URL_RO=(.+)$/m)[1].replace(/^["']|["']$/g, '');

let TOKEN = null, UID = null;
const db = new pg.Client({ connectionString: RO_URL, ssl: { rejectUnauthorized: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isoPlusDays = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

async function api(path, body, method = 'POST') {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}
async function signIn() {
  const res = await fetch(BASE + '/api/auth/email', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const j = await res.json(); TOKEN = j.token; UID = j.user_uuid;
  if (!TOKEN) throw new Error('signin failed ' + JSON.stringify(j));
}
async function readActivePlan() {
  const p = (await db.query(
    `SELECT id, mode FROM training_plans WHERE user_uuid=$1 AND archived_iso IS NULL
       ORDER BY authored_iso DESC LIMIT 1`, [UID])).rows[0];
  if (!p) return null;
  const weeks = (await db.query(
    `SELECT id, week_idx, week_start_iso, is_race_week FROM plan_weeks WHERE plan_id=$1 ORDER BY week_idx`, [p.id])).rows;
  const workouts = (await db.query(
    `SELECT week_id, date_iso, dow, type, distance_mi::float AS distance_mi,
            is_quality, is_long, sub_label, workout_spec
       FROM plan_workouts WHERE plan_id=$1 ORDER BY date_iso, dow`, [p.id])).rows;
  return { plan: p, weeks, workouts };
}

function analyze(plan, label) {
  const byWeek = new Map();
  for (const w of plan.workouts) {
    if (!byWeek.has(w.week_id)) byWeek.set(w.week_id, []);
    byWeek.get(w.week_id).push(w);
  }
  const violations = [];
  const weekDump = [];
  for (const wk of plan.weeks) {
    const rows = byWeek.get(wk.id) || [];
    const longMi = Math.max(0, ...rows.filter(r => r.is_long).map(r => r.distance_mi));
    const qrows = rows.filter(r => r.is_quality && r.type !== 'race');
    const qmax = Math.max(0, ...qrows.map(r => r.distance_mi));
    const qOverLong = qrows.filter(r => longMi > 0 && r.distance_mi > longMi + 0.001);
    for (const q of qOverLong) {
      violations.push({
        week: wk.week_idx, date: q.date_iso, type: q.type, sub: q.sub_label,
        qmi: q.distance_mi, longMi,
        spec: q.workout_spec,
      });
    }
    weekDump.push({ wk: wk.week_idx, isRace: wk.is_race_week, longMi,
      q: qrows.map(r => ({ t: r.type, mi: r.distance_mi, sub: r.sub_label })) });
  }
  return { label, planId: plan.plan.id, mode: plan.plan.mode, violations, weekDump };
}

async function scenario(weeklyFreq) {
  const date = isoPlusDays(9 * 7);
  // onboarding/complete with no race first to set profile fields
  await api('/api/onboarding/complete', {
    distance: 'none', weeklyMi: 25, weeklyFreq, histAvg: null, histLong: null, histYears: null,
    experienceLevel: 'intermediate', name: 'Test Runner', timezone: 'America/Los_Angeles',
    connectionsSkipped: true, longRunDay: 'sun',
  });
  await sleep(300);
  // goal path: 5K goal 18:30, plan_weeks 9
  const resp = await api('/api/profile/goal', {
    distance_label: '5K', goal_time: '18:30', plan_weeks: 9, start_date: isoPlusDays(1),
  });
  await sleep(500);
  const plan = await readActivePlan();
  if (!plan) return { label: `freq${weeklyFreq}`, error: `NO PLAN ${resp.status} ${JSON.stringify(resp.json)}` };
  return analyze(plan, `freq${weeklyFreq}`);
}

async function main() {
  await signIn();
  await db.connect();
  console.error(`uid=${UID}`);
  const out = [];
  for (const freq of [3, 4, 5]) {
    out.push(await scenario(freq));
    await sleep(300);
  }
  await db.end();
  console.log(JSON.stringify(out, null, 1));
}
main().catch(e => { console.error('ERR', e); process.exit(1); });
