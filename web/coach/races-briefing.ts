/**
 * races-briefing · LLM-driven { voice, topics[] } for the /races page.
 *
 * Mirrors today-briefing in structure but with race-domain prompt +
 * topic kinds (race_horizon, race_trajectory, race_calendar_overview,
 * race_retrospective, goal_renegotiation).
 *
 * Caching: keyed on user + today_iso + race_calendar_hash. Cache miss
 * → fresh LLM call. Less frequent invalidation than today-briefing
 * (the calendar doesn't change every run).
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RacesState } from '@/lib/coach/races-state';

const REPO_ROOT = process.cwd().endsWith('/web') ? join(process.cwd(), '..') : process.cwd();
let _systemPrompt: string | null = null;
function systemPrompt(): string {
  if (_systemPrompt == null) {
    _systemPrompt = readFileSync(join(REPO_ROOT, 'web/coach/prompts/races-overview.md'), 'utf-8');
  }
  return _systemPrompt;
}

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  _client = new Anthropic({ apiKey });
  return _client;
}

export type RaceTopicCard =
  | { kind: 'race_horizon'; name: string; days_away: number; tone: 'comfortable' | 'building' | 'tightening' | 'race_week'; coach_note: string }
  | { kind: 'race_trajectory'; race_name: string; goal_label: string; current_projection_label: string; state: 'ahead' | 'on_track' | 'behind' | 'collecting_evidence'; weeks_left: number; coach_note: string }
  | { kind: 'race_calendar_overview'; races: Array<{ name: string; date: string; days_away: number; priority: string | null; kind: string }>; coach_note: string }
  | { kind: 'race_retrospective'; name: string; finished_iso: string; actual_time: string; goal_time: string | null; verdict: string; coach_note: string }
  | { kind: 'goal_renegotiation'; race_name: string; current_goal: string; proposed_goal: string; reasoning: string; options: Array<{ label: string; value: string }> };

export interface RacesBriefing {
  voice: string;
  topics: RaceTopicCard[];
  fromLLM: boolean;
  meta: { inputTokens: number; outputTokens: number; cacheReadTokens: number; elapsedMs: number };
}

function buildUserMessage(s: RacesState): string {
  const lines: string[] = [];
  lines.push(`RUNNER: ${s.runner.firstName}.`);
  lines.push(`TODAY: ${s.today}.`);
  lines.push('');

  if (s.activePlanRace) {
    lines.push(`ACTIVE PLAN BUILDING TOWARD: ${s.activePlanRace.name} (${s.activePlanRace.kind ?? 'race'}, ${s.activePlanRace.date}, ${s.activePlanRace.daysAway} days out).`);
  } else {
    lines.push(`ACTIVE PLAN: none / no race goal set.`);
  }
  lines.push('');

  lines.push(`ALL RACES ON CALENDAR (sorted by date):`);
  for (const r of s.races) {
    const pastFut = r.daysAway < 0 ? `(${Math.abs(r.daysAway)}d ago)` : `(in ${r.daysAway}d)`;
    const pri = r.priority ? `[${r.priority}]` : '[-]';
    const status = r.isCompleted ? `COMPLETED${r.actualResult ? ` · ${r.actualResult.time}${r.actualResult.goalTime ? ` vs goal ${r.actualResult.goalTime}` : ''}` : ''}` : 'upcoming';
    lines.push(`  · ${r.date} ${pastFut} ${pri} ${r.name} (${r.kind ?? '?'}) — ${status}`);
  }
  lines.push('');

  if (s.nextARace) {
    lines.push(`NEXT A-RACE: ${s.nextARace.name} in ${s.nextARace.daysAway} days (${s.nextARace.date}).`);
    lines.push('');
  }
  if (s.recentRace) {
    lines.push(`MOST RECENT RACE: ${s.recentRace.name} on ${s.recentRace.date} (${Math.abs(s.recentRace.daysAway)} days ago)${s.recentRace.actualResult ? ` · finished ${s.recentRace.actualResult.time}` : ''}.`);
    lines.push('');
  }

  if (s.vdotSnapshot?.value) {
    lines.push(`FITNESS SIGNAL: VDOT ~${s.vdotSnapshot.value.toFixed(1)} (source: ${s.vdotSnapshot.source}).`);
    lines.push('');
  } else {
    lines.push(`FITNESS SIGNAL: not yet computed at this level.`);
    lines.push('');
  }

  lines.push(`# YOUR JOB`);
  lines.push('');
  lines.push(`Speak to the multi-race arc. Next upcoming goal + the path to get there + the calendar as a whole. The runner opened /races to think about their season, not their day. Write 2-4 short paragraphs. Emit a race_horizon for the next A-race. Emit race_trajectory if you can make an honest call. Other topics as warranted.`);

  return lines.join('\n');
}

export async function generateRacesBriefing(state: RacesState): Promise<RacesBriefing> {
  const userMessage = buildUserMessage(state);
  const t0 = Date.now();
  const c = client();
  const response = await c.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1500,
    system: [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMessage }],
  });
  const raw = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = m ? m[1].trim() : raw;
  let parsed: { voice?: string; topics?: RaceTopicCard[] };
  try { parsed = JSON.parse(jsonText); }
  catch (e) { throw new Error(`races LLM returned non-JSON: ${raw.slice(0, 300)}`); }
  return {
    voice: typeof parsed.voice === 'string' ? parsed.voice.trim() : '',
    topics: Array.isArray(parsed.topics) ? parsed.topics : [],
    fromLLM: true,
    meta: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      elapsedMs: Date.now() - t0,
    },
  };
}
