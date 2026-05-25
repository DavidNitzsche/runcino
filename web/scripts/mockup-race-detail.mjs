/**
 * mockup-race-detail.mjs — coach output for the RACE DETAIL mockup.
 *
 * For one specific race: AFC Half (83 days out, building tone).
 * Proximity adaptation lives in the prompt — different content density
 * + tone progression based on days_away.
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
const RACE_SLUG = 'americas-finest-city';

const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const SYSTEM = `You are the coach on a RACE DETAIL page for ONE specific race. Same voice as the daily briefing.

# Proximity-adaptive content
The runner opened this page to think about THIS race. Density + specificity scale with days_away:

- 84d+ comfortable: broad framing, "we're building toward this," plan-phase context. No fueling specifics, no weather.
- 30-84d building: quality work showing up, course profile starts entering, more specific trajectory.
- 14-30d tightening: pace prediction concrete, taper logic appears, course study deepens, weather window emerging.
- 7-14d taper: fueling plan locked, race-week voice, weather forecast specific, pacing strategy.
- <7d race_week: "trust the work" register, race-morning logistics, gel timing concrete.
- race_day: own page entirely.

The COACH adapts what to say based on days_away. 2-4 short paragraphs in voice. Cards keyed to proximity.

# Output JSON
{ "voice": "<paragraphs>", "topics": [...] }

Topic kinds (all have coach_note):
- race_horizon: { kind, name, days_away, tone, coach_note }
- race_trajectory: { kind, race_name, goal_label, current_projection_label, state, weeks_left, coach_note }
- pace_prediction: { kind, race_name, predicted_finish, target_pace, confidence: low|medium|high, coach_note }
- course_intel: { kind, race_name, course_summary, key_features: [...], coach_note }   // emit when <60d
- weather_forecast: { kind, race_name, temp_f, conditions, headwind_mph, coach_note }  // emit when <10d only
- fueling_plan: { kind, race_name, gel_count, water_strategy, gels_at_mi: [...], coach_note }  // emit when <14d
- pacing_strategy: { kind, race_name, splits: [{mi_range, target_pace}], strategy_summary, coach_note }  // emit when <14d
- taper_status: { kind, race_name, week_label, intent, coach_note }  // emit when <21d
- past_race_reference: { kind, race_name, prior_finish_at_distance, prior_date, takeaway, coach_note }

For 83 days out, the right cards are likely: race_horizon, race_trajectory (if computable), past_race_reference. Course intel borderline. NO fueling, NO weather, NO pacing strategy yet — too far out.

NO markdown fences. JSON only.`;

async function loadState() {
  const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);

  const raceRows = await pool.query(`SELECT slug, meta, actual_result, gpx_text IS NOT NULL AS has_gpx FROM races WHERE slug = $1 LIMIT 1`, [RACE_SLUG]);
  const r = raceRows.rows[0];
  if (!r) throw new Error('Race not found: ' + RACE_SLUG);
  const meta = r.meta ?? {};
  const daysAway = Math.round((Date.parse(meta.date + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000);

  // Past finishes at same distance (half marathon)
  const sameDistRows = await pool.query(`
    SELECT slug, meta, actual_result FROM races
    WHERE (user_uuid = $1 OR user_uuid IS NULL) AND actual_result IS NOT NULL
      AND (meta->>'distanceMi')::numeric BETWEEN 13.0 AND 13.5
  `, [USER_ID]);
  const pastHalves = sameDistRows.rows.map(x => ({
    name: x.meta?.name ?? x.slug,
    date: x.meta?.date,
    finishS: x.actual_result?.finishS,
    paceSPerMi: x.actual_result?.paceSPerMi,
  })).filter(p => p.date && p.finishS).sort((a, b) => b.date.localeCompare(a.date));

  // Plan context
  const plan = (await pool.query(`SELECT id, race_id FROM training_plans WHERE (user_uuid = $1 OR user_id = 'me') AND archived_iso IS NULL ORDER BY authored_iso DESC LIMIT 1`, [USER_ID])).rows[0];

  return {
    today,
    race: {
      slug: r.slug,
      name: meta.name,
      date: meta.date,
      distanceMi: meta.distanceMi,
      goalDisplay: meta.goalDisplay,
      priority: meta.priority,
      hasGpx: r.has_gpx,
      daysAway,
    },
    pastHalves,
    activePlanFor: plan?.race_id,
  };
}

function buildMessage(s) {
  const lines = [];
  lines.push(`RUNNER: David.`);
  lines.push(`TODAY: ${s.today}.`);
  lines.push('');
  lines.push(`RACE FOCUS: ${s.race.name} on ${s.race.date} (${s.race.daysAway} days out).`);
  lines.push(`  Distance: ${s.race.distanceMi} mi · Priority: ${s.race.priority || '-'} · Goal: ${s.race.goalDisplay || 'none set'}`);
  lines.push(`  GPX/course data available: ${s.race.hasGpx ? 'yes' : 'no'}`);
  lines.push(`  Active plan is for: ${s.activePlanFor === s.race.slug ? 'this race' : (s.activePlanFor ?? 'no plan')}`);
  lines.push('');
  if (s.pastHalves.length > 0) {
    lines.push(`PAST HALF MARATHONS (this runner):`);
    s.pastHalves.forEach(p => {
      const min = Math.floor(p.finishS / 60);
      const sec = p.finishS % 60;
      lines.push(`  · ${p.date} · ${p.name} · ${min}:${String(sec).padStart(2, '0')}`);
    });
    lines.push('');
  }
  lines.push(`# YOUR JOB`);
  lines.push(`Coach voice for this race specifically, 2-4 paragraphs. Apply proximity rules (this is 83 days out — comfortable/building zone). Reference past halves. Emit cards per the proximity rules.`);
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
  console.log(JSON.stringify(state, null, 2));
  await pool.end();
}

main().catch((e) => { console.error('ERROR:', e); pool.end(); process.exit(1); });
