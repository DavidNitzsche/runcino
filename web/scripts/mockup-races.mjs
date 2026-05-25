/**
 * mockup-races.mjs — generates real coach output for the RACES mockup.
 *
 * Pulls David's actual race calendar + plan + VDOT from prod, calls
 * Claude with the races-overview prompt, prints the { voice, topics }
 * JSON we then paste into the HTML mockup.
 *
 * No prod side effects. Read-only DB + Anthropic API.
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

const SYSTEM = `You are the coach on the RACES page. Same voice as the daily briefing: warm, "we"/"us", names races by name, honest about challenges, no clichés, no jargon, no em dashes, no exclamation marks.

# What this surface is about
- The next upcoming goal (next race, especially next A-race)
- The path to get there (where we are in the build)
- The race calendar as a whole (next → after → after)

The runner opened this page to think about their season, not their day. Speak to the arc.

# Voice
2-4 short paragraphs. Big picture. Honest if a goal is in range, ahead, or tight. Reference continuity to the next race after this one.

# Output — strict JSON
{ "voice": "<paragraphs separated by \\n\\n>", "topics": [...] }

Topic kinds allowed (use only these):
- race_horizon: { kind, name, days_away, tone: comfortable|building|tightening|race_week, coach_note }
- race_trajectory: { kind, race_name, goal_label, current_projection_label, state: ahead|on_track|behind|collecting_evidence, weeks_left, coach_note }
- race_calendar_overview: { kind, races: [{name, date, days_away, priority, kind}], coach_note }
- race_retrospective: { kind, name, finished_iso, actual_time, goal_time, verdict, coach_note }

Required emissions: race_horizon for the next A-race (always). Discretionary: trajectory if you can honestly call it, retrospective if there's a recent (<30d) finish worth processing, calendar overview if multi-race continuity matters.

NO markdown fences. JSON only.`;

function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
}

async function loadState() {
  const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);

  const races = (await pool.query(`SELECT slug, meta, actual_result FROM races WHERE user_uuid = $1 OR user_uuid IS NULL`, [USER_ID])).rows
    .map((r) => {
      const m = r.meta ?? {};
      if (!m.date) return null;
      return {
        slug: r.slug,
        name: m.name ?? r.slug,
        date: m.date,
        daysAway: daysBetween(today, m.date),
        priority: m.priority ?? null,
        distanceMi: m.distanceMi ?? null,
        completed: !!r.actual_result,
        actualResult: r.actual_result,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));

  const plan = (await pool.query(`SELECT race_id FROM training_plans WHERE (user_uuid = $1 OR user_id = 'me') AND archived_iso IS NULL ORDER BY authored_iso DESC LIMIT 1`, [USER_ID])).rows[0];

  const activeRace = plan?.race_id ? races.find((r) => r.slug === plan.race_id) : null;
  const upcoming = races.filter((r) => r.daysAway >= 0);
  const nextRace = upcoming[0] ?? null;
  const nextA = upcoming.find((r) => r.priority === 'A') ?? null;
  const recent = races.filter((r) => r.completed && r.daysAway >= -45).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;

  return { today, races, activeRace, nextRace, nextA, recent };
}

function buildMessage(s) {
  const lines = [];
  lines.push(`RUNNER: David.`);
  lines.push(`TODAY: ${s.today}.`);
  lines.push('');
  lines.push(s.activeRace
    ? `ACTIVE PLAN BUILDING TOWARD: ${s.activeRace.name} (${s.activeRace.date}, ${s.activeRace.daysAway} days out).`
    : `ACTIVE PLAN: none on the books.`);
  lines.push('');
  lines.push(`ALL RACES (sorted by date):`);
  for (const r of s.races) {
    const tag = r.daysAway < 0 ? `${Math.abs(r.daysAway)}d ago` : `in ${r.daysAway}d`;
    const pri = r.priority ?? '-';
    const dist = r.distanceMi ? `${r.distanceMi}mi` : '?';
    const status = r.completed ? `COMPLETED${r.actualResult?.finishS ? ` · ${Math.floor(r.actualResult.finishS / 60)}m${String(r.actualResult.finishS % 60).padStart(2, '0')}s` : ''}` : 'upcoming';
    lines.push(`  · ${r.date} (${tag}) [${pri}] ${r.name} · ${dist} · ${status}`);
  }
  lines.push('');
  if (s.nextA) lines.push(`NEXT A-RACE: ${s.nextA.name}, ${s.nextA.daysAway} days out.`);
  if (s.recent) lines.push(`MOST RECENT FINISH: ${s.recent.name} on ${s.recent.date}.`);
  lines.push('');
  lines.push(`# YOUR JOB`);
  lines.push(`Speak to the multi-race arc. 2-4 paragraphs + emit topics per the schema.`);
  return lines.join('\n');
}

async function main() {
  const state = await loadState();
  console.log('STATE:', JSON.stringify(state, null, 2).slice(0, 2000));
  console.log('\n---\n');

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
  const jsonText = m ? m[1].trim() : raw;
  const parsed = JSON.parse(jsonText);

  console.log('━━━ VOICE ━━━\n');
  console.log(parsed.voice);
  console.log('\n━━━ TOPICS ━━━\n');
  console.log(JSON.stringify(parsed.topics, null, 2));
  console.log(`\n  · ${((Date.now() - t0) / 1000).toFixed(1)}s · ${resp.usage.input_tokens} in / ${resp.usage.output_tokens} out`);

  console.log('\n\n━━━ FULL PAYLOAD (paste into mockup) ━━━\n');
  console.log(JSON.stringify({ state, briefing: parsed }, null, 2));

  await pool.end();
}

main().catch((e) => { console.error('ERROR:', e); pool.end(); process.exit(1); });
