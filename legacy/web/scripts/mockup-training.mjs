/**
 * mockup-training.mjs — coach output for the TRAINING mockup.
 *
 * Coach speaks to: the week ahead, the overall plan, what needs to happen
 * to reach goal, what changes since last check-in.
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

const SYSTEM = `You are the coach on the TRAINING page. Same voice doctrine. You speak to the plan, not today's run.

# What this surface is about
- The week ahead (key sessions, week shape, intent)
- The overall plan arc (where this week fits in the phase, where the phase fits in the build)
- What needs to happen to reach the goal (the bridge from where we are to race day)
- Deltas since last check-in (mileage up, paces dropping, quality coming in)

# Voice
2-4 short paragraphs. Talk about the plan AS A STORY, not a schedule. "We're in week 1 of the build because X. Next 3 weeks the volume steps up. The first quality day shows up Tuesday — here's why now and not last week."

# Output strict JSON
{ "voice": "<paragraphs>", "topics": [...] }

Topic kinds (all have coach_note):
- week_ahead: { kind, week_label, planned_mi, sessions_count, key_session: {dow, type, label, mi}, coach_note }
- phase_context: { kind, phase, week_in_phase, weeks_remaining, phase_intent, coach_note }
- next_quality: { kind, date, dow, type, label, mi, what_to_focus_on, coach_note }
- volume_delta: { kind, this_week_mi, last_week_mi, delta_pct, direction: up|down|flat, coach_note }
- plan_arc: { kind, current_phase, phases_remaining: [{phase, week_count}], race_horizon_days, coach_note }
- plan_adapted: { kind, what_changed, why, coach_note }   // emit only when coach recently adjusted plan
- training_change_since_last: { kind, change_summary, examples: [...], coach_note }  // deltas worth flagging

Emit what's worth saying. Required: week_ahead + phase_context (the runner needs to know these orient them on the page). Discretionary: the rest.

NO markdown fences. JSON only.`;

async function loadState() {
  const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);

  const plan = (await pool.query(`SELECT id, race_id FROM training_plans WHERE (user_uuid = $1 OR user_id = 'me') AND archived_iso IS NULL ORDER BY authored_iso DESC LIMIT 1`, [USER_ID])).rows[0];
  if (!plan) throw new Error('No active plan');

  const phases = (await pool.query(`SELECT label, start_week_idx, end_week_idx FROM plan_phases WHERE plan_id = $1 ORDER BY start_week_idx`, [plan.id])).rows;
  const weeks = (await pool.query(`SELECT id::text AS id, week_idx, week_start_iso FROM plan_weeks WHERE plan_id = $1 ORDER BY week_idx`, [plan.id])).rows;
  const workouts = (await pool.query(`SELECT week_id::text AS week_id, date_iso, dow, type, distance_mi, sub_label FROM plan_workouts WHERE plan_id = $1 ORDER BY date_iso`, [plan.id])).rows;

  const labelForWeek = (idx) => phases.find(p => idx >= p.start_week_idx && idx <= p.end_week_idx)?.label ?? 'BASE';
  const woByWeek = new Map();
  for (const w of workouts) {
    if (!woByWeek.has(w.week_id)) woByWeek.set(w.week_id, []);
    const mi = Number(w.distance_mi) || 0;
    woByWeek.get(w.week_id).push({
      date: w.date_iso, dow: w.dow, type: w.type,
      label: w.sub_label || (w.type === 'rest' ? 'REST' : w.type.toUpperCase()),
      mi, isRest: w.type === 'rest' || mi === 0,
    });
  }
  const weekObjs = weeks.map(w => {
    const days = (woByWeek.get(w.id) ?? []).sort((a, b) => a.date.localeCompare(b.date));
    const plannedMi = Math.round(days.reduce((s, d) => s + d.mi, 0) * 10) / 10;
    return { idx: w.week_idx, phase: labelForWeek(w.week_idx), startDate: w.week_start_iso, plannedMi, days };
  });

  const currentWeek = weekObjs.find(w => w.days.some(d => d.date === today)) ?? weekObjs[weekObjs.length - 1];
  const currentIdx = weekObjs.indexOf(currentWeek);
  const prevWeek = currentIdx > 0 ? weekObjs[currentIdx - 1] : null;
  const nextThreeWeeks = weekObjs.slice(currentIdx + 1, currentIdx + 4);

  // Race
  const raceRow = plan.race_id ? (await pool.query(`SELECT slug, meta FROM races WHERE slug = $1`, [plan.race_id])).rows[0] : null;
  const race = raceRow ? { slug: raceRow.slug, name: raceRow.meta?.name, date: raceRow.meta?.date, goal: raceRow.meta?.goalDisplay } : null;

  // Recent actual mileage (last 4 weeks) for delta context
  const start4w = new Date(Date.parse(today + 'T00:00:00Z') - 28 * 86400000).toISOString().slice(0, 10);
  const stravaRecent = (await pool.query(`
    SELECT COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) AS day, SUM((data->>'distanceMi')::numeric) AS mi
    FROM strava_activities
    WHERE (user_uuid = $1 OR user_uuid IS NULL)
      AND NOT (data ? 'mergedIntoId')
      AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) BETWEEN $2 AND $3
    GROUP BY day
  `, [USER_ID, start4w, today])).rows;

  return { today, plan, phases, currentWeek, prevWeek, nextThreeWeeks, race, recentMileage: stravaRecent };
}

function buildMessage(s) {
  const lines = [];
  lines.push(`RUNNER: David.`);
  lines.push(`TODAY: ${s.today}.`);
  lines.push('');
  if (s.race) lines.push(`RACE: ${s.race.name} (${s.race.date}, goal ${s.race.goal || '-'})`);
  lines.push('');
  lines.push(`PHASES IN PLAN:`);
  for (const p of s.phases) lines.push(`  · ${p.label} (week ${p.start_week_idx} → ${p.end_week_idx})`);
  lines.push('');
  lines.push(`CURRENT WEEK: ${s.currentWeek.phase} week ${s.currentWeek.idx} · ${s.currentWeek.plannedMi}mi planned`);
  for (const d of s.currentWeek.days) {
    lines.push(`  · ${d.date} (${d.dow}) ${d.type} ${d.mi}mi ${d.label}`);
  }
  lines.push('');
  if (s.prevWeek) {
    lines.push(`PREVIOUS WEEK: ${s.prevWeek.phase} week ${s.prevWeek.idx} · ${s.prevWeek.plannedMi}mi planned`);
    lines.push('');
  }
  if (s.nextThreeWeeks.length) {
    lines.push(`NEXT THREE WEEKS:`);
    for (const w of s.nextThreeWeeks) lines.push(`  · week ${w.idx} · ${w.phase} · ${w.plannedMi}mi`);
    lines.push('');
  }
  const recent4w = s.recentMileage.reduce((sum, r) => sum + Number(r.mi), 0);
  lines.push(`RUNNER's LAST 4 WEEKS ACTUAL MILEAGE (sum): ${recent4w.toFixed(1)}mi across ${s.recentMileage.length} run-days`);
  lines.push('');
  lines.push(`# YOUR JOB`);
  lines.push(`Speak to the plan AS A STORY. Week ahead, phase context, what's coming. Emit cards per the schema.`);
  return lines.join('\n');
}

async function main() {
  const state = await loadState();
  const a = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const t0 = Date.now();
  const resp = await a.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1500,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: buildMessage(state) }],
  });
  const raw = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const parsed = JSON.parse(m ? m[1].trim() : raw);
  console.log('━━━ VOICE ━━━\n');
  console.log(parsed.voice);
  console.log('\n━━━ TOPICS ━━━\n');
  console.log(JSON.stringify(parsed.topics, null, 2));
  console.log(`\n  · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('\n━━━ STATE ━━━\n');
  console.log(JSON.stringify({
    currentWeek: state.currentWeek,
    prevWeek: state.prevWeek,
    nextThreeWeeks: state.nextThreeWeeks,
    phases: state.phases,
    race: state.race,
  }, null, 2));
  await pool.end();
}

main().catch((e) => { console.error('ERROR:', e); pool.end(); process.exit(1); });
