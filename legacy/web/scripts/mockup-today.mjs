/**
 * mockup-today.mjs — coach output for the TODAY surface (desktop / web companion).
 *
 * Same content as iPhone v4 but the web view has room for more cards in view at once.
 * Voice is still the same surface: warm, narrative, today-anchored.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
const env = Object.fromEntries(envText.split('\n').map((l) => l.match(/^([A-Z_]+)=(.+)$/)).filter(Boolean).map((m) => [m[1], m[2]]));

const USER_ID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const SYSTEM = `You are the coach on the TODAY page. This is the home surface.

# Voice doctrine
You talk like a coach who knows the runner well. Warm, direct, "we"/"us" language. Anchored to today (the run that just happened OR the day's intent if it's a rest day OR the day's plan if no run yet).

NOT textbook. NOT jargon-dump. NOT reciting their data back to them.

3-4 short paragraphs. Open with a one-line lead (a noun phrase, not a sentence). Then talk to them like a person.

The runner just got back from a long run (or completed the planned session). Speak to:
- What that run was, how it went, what it sets up
- The week's volume target — did they hit it
- One thing to watch (sleep, cadence, HR drift, RHR) IF there's signal worth raising — NEVER pad
- The next workout in plain terms (what + when + why)
- The race horizon as context for why this week matters

# Output strict JSON
{ "lead": "<noun phrase>", "voice": "<paragraphs>", "topics": [...] }

Topic kinds (every card carries a coach_note unless marked):
- sleep_deficit: { kind, avg_h_7n, deficit_h_7n, last_night_h, direction, coach_note }
- next_workout: { kind, dow, type, label, mi, coach_note }
- race_horizon: { kind, race_name, race_date, days_to_race, tone: building|sharpening|race_week, coach_note }
- cadence_insight: { kind, baseline_spm, today_spm, coach_note }
- profile_gap: { kind, field, why }            // no coach_note — the WHY is the coach line
- fun_fact: { kind, term, body, link_label }   // no coach_note — body IS the teach
- run_recap: { kind, distance_mi, pace, time, hr, cadence, weather_chip, coach_note }

Don't force cards. If sleep is fine, no sleep card. If there's no cadence story, no cadence card. The point is signal, not coverage.

NO markdown fences. JSON only.`;

async function loadState() {
  const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);

  // Profile (for height-gap detection)
  const prof = (await pool.query(`SELECT full_name, height_cm, hrmax, rhr FROM profile WHERE user_uuid = $1 OR (user_uuid IS NULL AND user_id = 'me') ORDER BY (user_uuid = $1) DESC LIMIT 1`, [USER_ID])).rows[0];

  // Latest activity (the run we'd recap)
  const recent = (await pool.query(`
    SELECT data
    FROM strava_activities
    WHERE (user_uuid = $1 OR user_uuid IS NULL)
      AND NOT (data ? 'mergedIntoId')
      AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) <= $2
    ORDER BY COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) DESC, COALESCE(data->>'startLocal','') DESC
    LIMIT 1
  `, [USER_ID, today])).rows[0];
  const r = recent?.data ?? null;
  const latest = r ? {
    date: r.date || (r.startLocal ?? '').slice(0, 10),
    mi: Number(r.distanceMi) || 0,
    pace: r.avgPaceMinPerMi || r.pace || null,
    timeMoving: r.timeMoving || r.duration || null,
    hr: Number(r.avgHr) || null,
    cadence: Number(r.avgCadence) || null,
    tempF: Number(r.tempF) || null,
    name: r.name || null,
  } : null;

  // Week mileage — sum strava + plan target
  const monday = (() => {
    const d = new Date(today + 'T12:00:00Z');
    const dow = d.getUTCDay(); // 0=Sun
    const shift = dow === 0 ? -6 : (1 - dow);
    return new Date(d.getTime() + shift * 86400000).toISOString().slice(0, 10);
  })();
  const weekRuns = (await pool.query(`
    SELECT COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) AS day, SUM((data->>'distanceMi')::numeric) AS mi
    FROM strava_activities
    WHERE (user_uuid = $1 OR user_uuid IS NULL)
      AND NOT (data ? 'mergedIntoId')
      AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) BETWEEN $2 AND $3
    GROUP BY day
    ORDER BY day
  `, [USER_ID, monday, today])).rows;
  const weekDone = weekRuns.reduce((s, r) => s + Number(r.mi), 0);

  // Plan + current week + next workout
  const plan = (await pool.query(`SELECT id, race_id FROM training_plans WHERE (user_uuid = $1 OR user_id = 'me') AND archived_iso IS NULL ORDER BY authored_iso DESC LIMIT 1`, [USER_ID])).rows[0];
  let weekPlanned = null, currentWeekDays = [], nextWorkout = null, phaseLabel = null;
  if (plan) {
    const weeks = (await pool.query(`SELECT id::text AS id, week_idx, week_start_iso FROM plan_weeks WHERE plan_id = $1 ORDER BY week_idx`, [plan.id])).rows;
    const phases = (await pool.query(`SELECT label, start_week_idx, end_week_idx FROM plan_phases WHERE plan_id = $1 ORDER BY start_week_idx`, [plan.id])).rows;
    const workouts = (await pool.query(`SELECT week_id::text AS week_id, date_iso, dow, type, distance_mi, sub_label FROM plan_workouts WHERE plan_id = $1 ORDER BY date_iso`, [plan.id])).rows;

    const cw = weeks.find(w => workouts.some(x => x.week_id === w.id && x.date_iso === today)) || weeks.find(w => w.week_start_iso <= today && new Date(Date.parse(w.week_start_iso + 'T00:00:00Z') + 7 * 86400000).toISOString().slice(0, 10) > today);
    if (cw) {
      const days = workouts.filter(w => w.week_id === cw.id).sort((a, b) => a.date_iso.localeCompare(b.date_iso));
      currentWeekDays = days.map(d => ({ date: d.date_iso, dow: d.dow, type: d.type, mi: Number(d.distance_mi) || 0, label: d.sub_label }));
      weekPlanned = Math.round(currentWeekDays.reduce((s, d) => s + d.mi, 0) * 10) / 10;
      phaseLabel = phases.find(p => cw.week_idx >= p.start_week_idx && cw.week_idx <= p.end_week_idx)?.label;
    }
    const upcoming = workouts.filter(w => w.date_iso > today && w.type !== 'rest' && Number(w.distance_mi) > 0).sort((a, b) => a.date_iso.localeCompare(b.date_iso))[0];
    if (upcoming) nextWorkout = { date: upcoming.date_iso, dow: upcoming.dow, type: upcoming.type, mi: Number(upcoming.distance_mi) || 0, label: upcoming.sub_label };
  }

  // Sleep last 7
  const sleep = (await pool.query(`SELECT sample_date, value FROM health_samples WHERE user_id = $1 AND sample_type = 'sleep_hours' AND sample_date <= $2::date ORDER BY sample_date DESC LIMIT 7`, [USER_ID, today])).rows;
  const sleepVals = sleep.map(r => Number(r.value)).filter(v => v > 0);
  const sleep7Avg = sleepVals.length ? sleepVals.reduce((s, x) => s + x, 0) / sleepVals.length : null;
  const sleep7Deficit = sleepVals.reduce((s, x) => s + Math.max(0, 7.5 - x), 0);

  // Cadence baseline + today
  const cad60 = (await pool.query(`
    SELECT AVG(value)::numeric AS avg FROM health_samples
    WHERE user_id=$1 AND sample_type='cadence' AND sample_date >= ($2::date - interval '60 days')
  `, [USER_ID, today])).rows[0];
  const cadenceBaseline = cad60?.avg ? Math.round(Number(cad60.avg)) : null;

  // RHR
  const rhr = (await pool.query(`SELECT value FROM health_samples WHERE user_id = $1 AND sample_type = 'resting_hr' AND recorded_at >= NOW() - interval '60 days' ORDER BY recorded_at DESC LIMIT 14`, [USER_ID])).rows;
  const rhrVals = rhr.map(r => Number(r.value)).filter(v => v > 0);
  const rhrCurrent = rhrVals[0] ?? null;
  const rhrBaseline = rhrVals.length ? Math.round(rhrVals.reduce((s, x) => s + x, 0) / rhrVals.length) : null;

  // Race
  const raceRow = plan?.race_id ? (await pool.query(`SELECT slug, meta FROM races WHERE slug = $1`, [plan.race_id])).rows[0] : null;
  const race = raceRow ? { slug: raceRow.slug, name: raceRow.meta?.name, date: raceRow.meta?.date, goal: raceRow.meta?.goalDisplay } : null;
  const daysToRace = race ? Math.round((Date.parse(race.date + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000) : null;

  return {
    today, monday, profile: prof, phaseLabel,
    latest, weekDone: Math.round(weekDone * 10) / 10, weekPlanned, currentWeekDays,
    nextWorkout,
    sleep: { last7Avg: sleep7Avg ? +sleep7Avg.toFixed(1) : null, deficit7: +sleep7Deficit.toFixed(1), nights: sleepVals },
    cadenceBaseline,
    rhr: { current: rhrCurrent, baseline: rhrBaseline },
    race, daysToRace,
  };
}

function buildMessage(s) {
  const lines = [];
  lines.push(`RUNNER: ${s.profile?.full_name ?? 'David'}.`);
  lines.push(`TODAY: ${s.today}.`);
  lines.push(`PHASE: ${s.phaseLabel ?? 'unknown'}.`);
  lines.push('');
  if (s.latest) {
    lines.push(`LATEST RUN (${s.latest.date}): ${s.latest.mi.toFixed(1)}mi · pace ${s.latest.pace || '—'} · time ${s.latest.timeMoving || '—'} · HR ${s.latest.hr || '—'} · cad ${s.latest.cadence || '—'} · ${s.latest.tempF ? s.latest.tempF + '°F' : '—'}${s.latest.name ? ' · "' + s.latest.name + '"' : ''}`);
  } else {
    lines.push(`NO RECENT RUN — today appears to be a rest/quiet day.`);
  }
  lines.push('');
  lines.push(`WEEK SO FAR (since ${s.monday}): ${s.weekDone}mi done / ${s.weekPlanned ?? '?'}mi planned`);
  lines.push(`THIS WEEK'S DAYS:`);
  for (const d of s.currentWeekDays) lines.push(`  · ${d.date} (${d.dow}) ${d.type} ${d.mi}mi ${d.label ?? ''}`);
  lines.push('');
  if (s.nextWorkout) lines.push(`NEXT WORKOUT: ${s.nextWorkout.date} (${s.nextWorkout.dow}) ${s.nextWorkout.type} ${s.nextWorkout.mi}mi ${s.nextWorkout.label ?? ''}`);
  lines.push('');
  lines.push(`SLEEP last 7n: ${s.sleep.last7Avg ?? '—'}h avg · ${s.sleep.deficit7}h cumulative deficit vs 7.5h target`);
  lines.push(`CADENCE 60d baseline: ${s.cadenceBaseline ?? '—'} spm · today: ${s.latest?.cadence ?? '—'} spm`);
  lines.push(`RHR: current ${s.rhr.current ?? '—'} · 14d baseline ${s.rhr.baseline ?? '—'}`);
  lines.push('');
  if (s.race) lines.push(`A-RACE: ${s.race.name} in ${s.daysToRace} days (${s.race.date}) · goal ${s.race.goal ?? '-'}`);
  lines.push('');
  lines.push(`PROFILE GAPS: height_cm = ${s.profile?.height_cm ?? 'MISSING'}.`);
  lines.push('');
  lines.push(`# YOUR JOB`);
  lines.push(`Coach voice for the TODAY surface — warm, narrative, anchored to today's run. Lead + 3-4 paragraphs + cards. Emit only the cards there's signal for. NEVER pad.`);
  return lines.join('\n');
}

async function main() {
  const state = await loadState();
  const a = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const t0 = Date.now();
  const resp = await a.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1800,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: buildMessage(state) }],
  });
  const raw = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  console.log('━━━ RAW LLM OUTPUT ━━━\n');
  console.log(raw);
  let jsonText = raw;
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonText = fenceMatch[1].trim();
  else {
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first >= 0 && last > first) jsonText = raw.slice(first, last + 1);
  }
  const parsed = JSON.parse(jsonText);
  console.log('\n━━━ LEAD ━━━\n');
  console.log(parsed.lead);
  console.log('\n━━━ VOICE ━━━\n');
  console.log(parsed.voice);
  console.log('\n━━━ TOPICS ━━━\n');
  console.log(JSON.stringify(parsed.topics, null, 2));
  console.log(`\n  · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('\n━━━ STATE ━━━\n');
  console.log(JSON.stringify(state, null, 2));
  await pool.end();
}

main().catch((e) => { console.error('ERROR:', e); pool.end(); process.exit(1); });
