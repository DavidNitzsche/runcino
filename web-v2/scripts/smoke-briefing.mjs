#!/usr/bin/env node
/**
 * smoke-briefing.mjs — runs the engine pipeline against real prod, no Next.js.
 *
 * Usage:
 *   node scripts/smoke-briefing.mjs                # today/post-run (auto-detect)
 *   node scripts/smoke-briefing.mjs --surface today --mode auto
 *
 * Reads .env.local for DATABASE_URL + ANTHROPIC_API_KEY. Prints:
 *   - resolved mode
 *   - eligibleKinds after prereq filter
 *   - the LLM voice + topics
 *   - the voice-eval verdict (PASS / WARN / FAIL)
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_V2 = join(__dirname, '..');
const REPO = join(WEB_V2, '..');

// ── env ──
const envPath = join(WEB_V2, '.env.local');
if (!existsSync(envPath)) {
  console.error('No .env.local at', envPath);
  console.error('Copy .env.example to .env.local and fill in DATABASE_URL + ANTHROPIC_API_KEY.');
  process.exit(2);
}
const envText = readFileSync(envPath, 'utf8');
const env = Object.fromEntries(
  envText.split('\n')
    .map((l) => l.match(/^([A-Z_]+)=(.+)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]])
);

const USER_ID = env.DEFAULT_USER_ID || '0645f40c-951d-4ccc-b86e-9979cd26c795';
const args = parseArgs(process.argv.slice(2));
const surface = args.surface ?? 'today';

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 4,
});

async function loadState() {
  const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);

  const profile = (await pool.query(
    `SELECT full_name, sex, age, city, hrmax, rhr, height_cm
       FROM profile WHERE user_uuid = $1 OR (user_uuid IS NULL AND user_id = 'me')
      ORDER BY (user_uuid = $1) DESC LIMIT 1`,
    [USER_ID]
  )).rows[0] ?? null;

  const r = (await pool.query(
    `SELECT data FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL) AND NOT (data ? 'mergedIntoId')
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) <= $2::text
      ORDER BY COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) DESC LIMIT 1`,
    [USER_ID, today]
  )).rows[0]?.data ?? null;

  const latest_activity = r ? {
    id: r.id ?? `${r.date}-${r.distanceMi}`,
    date: r.date || (r.startLocal ?? '').slice(0, 10),
    mi: Number(r.distanceMi) || 0,
    pace: r.avgPaceMinPerMi || r.pace || null,
    timeMoving: r.timeMoving || r.duration || null,
    hr: Number(r.avgHr) || null,
    cadence: Number(r.avgCadence) || null,
    tempF: Number(r.tempF) || null,
    name: r.name || null,
  } : null;

  // Plan + race
  const plan = (await pool.query(
    `SELECT id, race_id FROM training_plans
      WHERE (user_uuid = $1 OR user_id = 'me') AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [USER_ID]
  )).rows[0];

  let weekPlanned = null, phaseLabel = null, currentWeekDays = [], nextWorkout = null, nextARace = null;
  if (plan) {
    const weeks = (await pool.query(`SELECT id::text AS id, week_idx, week_start_iso FROM plan_weeks WHERE plan_id = $1 ORDER BY week_idx`, [plan.id])).rows;
    const phases = (await pool.query(`SELECT label, start_week_idx, end_week_idx FROM plan_phases WHERE plan_id = $1`, [plan.id])).rows;
    const workouts = (await pool.query(`SELECT week_id::text AS week_id, date_iso, dow, type, distance_mi, sub_label FROM plan_workouts WHERE plan_id = $1 ORDER BY date_iso`, [plan.id])).rows;
    const cw = weeks.find((w) => workouts.some((x) => x.week_id === w.id && x.date_iso === today))
      ?? weeks.find((w) => w.week_start_iso <= today && new Date(Date.parse(w.week_start_iso + 'T00:00:00Z') + 7 * 86400000).toISOString().slice(0, 10) > today);
    if (cw) {
      const days = workouts.filter((w) => w.week_id === cw.id);
      currentWeekDays = days.map((d) => ({ date: d.date_iso, dow: d.dow, type: d.type, mi: Number(d.distance_mi) || 0, label: d.sub_label }));
      weekPlanned = Math.round(currentWeekDays.reduce((s, d) => s + d.mi, 0) * 10) / 10;
      phaseLabel = phases.find((p) => cw.week_idx >= p.start_week_idx && cw.week_idx <= p.end_week_idx)?.label ?? null;
    }
    const up = workouts.filter((w) => w.date_iso > today && w.type !== 'rest' && Number(w.distance_mi) > 0)
      .sort((a, b) => a.date_iso.localeCompare(b.date_iso))[0];
    if (up) nextWorkout = { date: up.date_iso, dow: up.dow, type: up.type, mi: Number(up.distance_mi) || 0, label: up.sub_label };
    if (plan.race_id) {
      const race = (await pool.query(`SELECT slug, meta FROM races WHERE slug = $1`, [plan.race_id])).rows[0];
      if (race) {
        const date = race.meta?.date;
        const days_to_race = Math.round((Date.parse(date + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000);
        nextARace = { slug: race.slug, name: race.meta?.name, date, goal: race.meta?.goalDisplay ?? null, days_to_race };
      }
    }
  }

  const sleep = (await pool.query(`SELECT value FROM health_samples WHERE user_id = $1 AND sample_type = 'sleep_hours' AND sample_date <= $2::date ORDER BY sample_date DESC LIMIT 7`, [USER_ID, today])).rows.map((r) => Number(r.value)).filter((v) => v > 0);
  const sleep7Avg = sleep.length ? +(sleep.reduce((s, x) => s + x, 0) / sleep.length).toFixed(1) : null;
  const sleep7Deficit = +sleep.reduce((s, x) => s + Math.max(0, 7.5 - x), 0).toFixed(1);

  const rhr = (await pool.query(`SELECT value FROM health_samples WHERE user_id = $1 AND sample_type = 'resting_hr' AND recorded_at >= NOW() - interval '60 days' ORDER BY recorded_at DESC LIMIT 14`, [USER_ID])).rows.map((r) => Number(r.value)).filter((v) => v > 0);
  const rhrCurrent = rhr[0] ?? null;
  const rhrBaseline = rhr.length ? Math.round(rhr.reduce((s, x) => s + x, 0) / rhr.length) : null;

  const hrv = (await pool.query(`SELECT value FROM health_samples WHERE user_id = $1 AND sample_type = 'hrv' ORDER BY recorded_at DESC LIMIT 30`, [USER_ID])).rows.map((r) => Number(r.value)).filter((v) => v > 0);
  const hrvCurrent = hrv[0] ?? null;
  const hrvBaseline = hrv.length ? Math.round(hrv.reduce((s, x) => s + x, 0) / hrv.length) : null;

  const cad = (await pool.query(`SELECT AVG(value)::numeric AS avg FROM health_samples WHERE user_id = $1 AND sample_type = 'cadence' AND sample_date >= ($2::date - interval '60 days')`, [USER_ID, today])).rows[0];
  const cadenceBaseline = cad?.avg ? Math.round(Number(cad.avg)) : null;

  const weekRuns = await pool.query(
    `SELECT SUM((data->>'distanceMi')::numeric) AS mi FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL) AND NOT (data ? 'mergedIntoId')
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10))
            BETWEEN to_char(date_trunc('week', $2::date), 'YYYY-MM-DD') AND $2::text`,
    [USER_ID, today]
  );
  const weekDone = Math.round(Number(weekRuns.rows[0]?.mi ?? 0) * 10) / 10;

  return {
    today, user_id: USER_ID,
    profile: profile ? { full_name: profile.full_name, sex: profile.sex, age: profile.age, city: profile.city,
      height_cm: profile.height_cm, hrmax: profile.hrmax, rhr: profile.rhr } : null,
    latest_activity, weekDone, weekPlanned, phaseLabel, currentWeekDays, nextWorkout, nextARace,
    sleep7Avg, sleep7Deficit, hrvCurrent, hrvBaseline, rhrCurrent, rhrBaseline, cadenceBaseline,
    recentCheckIns: [], pendingIntents: [], shoes: [],
  };
}

// ── Doctrine router (mirrors lib/coach/router.ts) ──
function resolveMode(surface, state) {
  if (surface !== 'today') return { surface, mode: 'unknown', candidateTopics: [] };
  const todayPlan = state.currentWeekDays.find((d) => d.date === state.today);
  const isRestDay = todayPlan?.type === 'rest';
  const isRaceDay = state.nextARace?.date === state.today;
  const ranToday  = state.latest_activity?.date === state.today;
  let mode;
  if (isRaceDay)   mode = 'race-day';
  else if (ranToday) mode = 'post-run';
  else if (isRestDay) mode = 'rest-day';
  else mode = 'pre-run';
  const cand = {
    'post-run': ['run_recap','sleep_deficit','next_workout','race_horizon','cadence_experiment','profile_gap'],
    'pre-run':  ['next_workout','sleep_deficit','watch_list','race_horizon','profile_gap'],
    'rest-day': ['next_workout','fun_fact','race_horizon'],
    'race-day': ['race_horizon'],
  };
  return { surface, mode, candidateTopics: cand[mode] ?? [] };
}

// ── Topic prereqs (mirrors lib/topics/types.ts) ──
const Prereqs = {
  run_recap:          (s) => s.latest_activity !== null,
  sleep_deficit:      (s) => s.sleep7Avg !== null && s.sleep7Deficit >= 1.5,
  next_workout:       (s) => s.nextWorkout !== null,
  race_horizon:       (s) => s.nextARace !== null,
  cadence_experiment: (s) => s.profile?.height_cm != null && s.cadenceBaseline !== null,
  profile_gap:        (s) => s.profile?.height_cm == null,
  fun_fact:           ()  => true,
  watch_list:         (s) => {
    const rhrElev = s.rhrCurrent != null && s.rhrBaseline != null && (s.rhrCurrent - s.rhrBaseline) >= 5;
    return rhrElev || s.sleep7Deficit >= 3.0;
  },
};

// ── System prompt (mirrors coach/prompts/index.ts post-run) ──
const SYSTEM_TODAY_POST_RUN = `You are the coach on the TODAY page · POST-RUN mode.

# Voice
Warm, direct, "we"/"us" language. Anchored to the moment.
Not textbook. Not jargon. Not reciting data.
3-4 short paragraphs. Open with a one-line LEAD as a noun phrase.

BANNED PHRASES:
- "aerobic engine" / "absorption window"
- "anchor" / "everything else supports it"
- "closest you'll ever come" or anything implying final attempt
- "the foundation" / "phase of training" / "putting in the work"

# Output (strict JSON, NO fences)
{
  "lead": "<noun phrase>",
  "voice": ["paragraph 1", "paragraph 2", ...],
  "topics": [ { "kind": "<topic_kind>", "payload": {...}, "coach_note": "<short>" } ]
}

# What you talk about (post-run)
- The run that just happened
- Week's volume hit
- One signal to watch IF worth raising
- Next workout in plain terms
- A-race as the season's frame

End by inviting check-in ("Let me know how it felt").`;

function buildUserMsg(state, resolved, eligible) {
  const L = [];
  L.push(`RUNNER: ${state.profile?.full_name ?? 'David'}.`);
  L.push(`TODAY: ${state.today}.`);
  L.push(`SURFACE: ${resolved.surface} · MODE: ${resolved.mode}.`);
  L.push('');
  if (state.latest_activity) {
    const a = state.latest_activity;
    L.push(`LATEST RUN (${a.date}): ${a.mi.toFixed(1)}mi · pace ${a.pace ?? '—'} · HR ${a.hr ?? '—'} · cad ${a.cadence ?? '—'}${a.name ? ' · "' + a.name + '"' : ''}`);
  }
  L.push(`WEEK: ${state.weekDone}mi done / ${state.weekPlanned ?? '?'}mi planned${state.phaseLabel ? ' · phase ' + state.phaseLabel : ''}`);
  if (state.nextWorkout) {
    const n = state.nextWorkout;
    L.push(`NEXT WORKOUT: ${n.date} ${n.type} ${n.mi}mi${n.label ? ' · ' + n.label : ''}`);
  }
  if (state.nextARace) L.push(`A-RACE: ${state.nextARace.name} in ${state.nextARace.days_to_race} days · goal ${state.nextARace.goal ?? '—'}`);
  L.push(`SLEEP: 7n avg ${state.sleep7Avg ?? '—'}h · deficit ${state.sleep7Deficit}h`);
  L.push(`RHR: current ${state.rhrCurrent ?? '—'} · 14d baseline ${state.rhrBaseline ?? '—'}`);
  L.push(`HRV: current ${state.hrvCurrent ?? '—'}ms · 30d baseline ${state.hrvBaseline ?? '—'}`);
  L.push(`CADENCE: 60d baseline ${state.cadenceBaseline ?? '—'} spm`);
  L.push('');
  L.push(`PROFILE FIELDS: height_cm: ${state.profile?.height_cm ?? 'MISSING'}`);
  L.push('');
  L.push(`ELIGIBLE TOPIC KINDS (prereqs met — emit ONLY these as cards):`);
  L.push(`  ${eligible.join(', ')}`);
  L.push('');
  L.push(`# YOUR JOB`);
  L.push(`Coach voice for this surface + mode. Strict JSON, no fences.`);
  return L.join('\n');
}

function parseArgs(a) {
  const o = {};
  for (let i = 0; i < a.length; i += 2) o[a[i].replace(/^--/, '')] = a[i + 1];
  return o;
}

async function main() {
  console.log('━━━ STATE LOAD ━━━');
  const state = await loadState();
  console.log({
    today: state.today,
    profile_height_cm: state.profile?.height_cm ?? null,
    latest_run: state.latest_activity ? `${state.latest_activity.date} ${state.latest_activity.mi}mi` : null,
    week: `${state.weekDone}/${state.weekPlanned ?? '?'}`,
    next_wo: state.nextWorkout ? `${state.nextWorkout.date} ${state.nextWorkout.type} ${state.nextWorkout.mi}mi` : null,
    a_race: state.nextARace ? `${state.nextARace.name} ${state.nextARace.days_to_race}d` : null,
    sleep_7n: state.sleep7Avg, sleep_def: state.sleep7Deficit,
    rhr: `${state.rhrCurrent ?? '—'}/${state.rhrBaseline ?? '—'}`,
    hrv: `${state.hrvCurrent ?? '—'}/${state.hrvBaseline ?? '—'}`,
    cadence_baseline: state.cadenceBaseline,
  });

  const resolved = resolveMode(surface, state);
  const eligible = resolved.candidateTopics.filter((k) => Prereqs[k](state));
  console.log('\n━━━ MODE ━━━');
  console.log(`  surface: ${resolved.surface}`);
  console.log(`  mode: ${resolved.mode}`);
  console.log(`  candidates: ${resolved.candidateTopics.join(', ')}`);
  console.log(`  eligible:   ${eligible.join(', ')}`);

  console.log('\n━━━ LLM CALL ━━━');
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const t0 = Date.now();
  const resp = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1800,
    system: [{ type: 'text', text: SYSTEM_TODAY_POST_RUN, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: buildUserMsg(state, resolved, eligible) }],
  });
  const raw = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  let jsonText = raw;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) jsonText = fence[1].trim();
  else {
    const f = raw.indexOf('{'); const l = raw.lastIndexOf('}');
    if (f >= 0 && l > f) jsonText = raw.slice(f, l + 1);
  }
  const parsed = JSON.parse(jsonText);
  const t = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`  ${t}s · ${parsed.topics?.length ?? 0} topics emitted`);
  console.log('\n━━━ LEAD ━━━');
  console.log(parsed.lead);
  console.log('\n━━━ VOICE ━━━');
  for (const p of parsed.voice ?? []) console.log(p + '\n');
  console.log('━━━ TOPICS ━━━');
  console.log(JSON.stringify(parsed.topics ?? [], null, 2));

  // Voice eval
  console.log('\n━━━ VOICE EVAL ━━━');
  const evalInput = '/tmp/smoke-briefing-candidate.json';
  writeFileSync(evalInput, JSON.stringify(parsed));
  const evalRes = spawnSync('node', [join(REPO, 'scripts/voice-eval/run.mjs'),
    '--surface', resolved.surface, '--mode', resolved.mode, '--input', evalInput], { stdio: 'inherit' });

  await pool.end();
  process.exit(evalRes.status ?? 0);
}

main().catch((e) => { console.error('ERROR:', e); pool.end(); process.exit(1); });
