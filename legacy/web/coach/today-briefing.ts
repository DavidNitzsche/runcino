/**
 * today-briefing · LLM-driven { voice, topics[] } for the TODAY page.
 *
 * Takes a TodayState (from web/lib/coach/today-state.ts), feeds it +
 * the daily-briefing.md prompt to Claude, returns structured output.
 * The renderer pulls voice + topics straight from the result.
 *
 * Suppression rules + card-library schemas live in
 * docs/coach/CARD_LIBRARY.md. This function applies the render-time
 * filters (e.g., drop cadence_experiment with null target_spm).
 *
 * Cache: keyed on (user_id, today, latest_activity_id, latest_checkin_id,
 * latest_intent_id) via coach_today_cache. Cache miss → fresh LLM call.
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TodayState, TodayPlanWorkout } from '@/lib/coach/today-state';

// ── Doc loading ──────────────────────────────────────────────────────
const REPO_ROOT = process.cwd().endsWith('/web') ? join(process.cwd(), '..') : process.cwd();
let _systemPrompt: string | null = null;
function systemPrompt(): string {
  if (_systemPrompt == null) {
    _systemPrompt = readFileSync(join(REPO_ROOT, 'web/coach/prompts/daily-briefing.md'), 'utf-8');
  }
  return _systemPrompt;
}

// ── Client ───────────────────────────────────────────────────────────
let _client: Anthropic | null = null;
function client(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  _client = new Anthropic({ apiKey });
  return _client;
}

export function llmAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// ── Topic types (mirror docs/coach/CARD_LIBRARY.md) ───────────────────

export type TopicCard =
  | { kind: 'cadence_experiment'; current_spm: number; target_spm: number | null; reason: string; action_label: string; coach_note: string }
  | { kind: 'sleep_deficit'; avg7n_h: number; target_h: number; deficit_7n_h: number; last_night_h: number; coach_note: string }
  | { kind: 'next_workout'; date: string; dow: string; type: string; label: string; distance_mi: number; pace_target: string | null; coach_note: string }
  | { kind: 'profile_gap'; field: string; why: string }
  | { kind: 'fun_fact'; term: string; title: string; explanation: string; research_doc?: string | null }
  | { kind: 'weight_trend'; current_lb: number; delta_lb_30d: number; direction: 'up' | 'down' | 'flat'; coach_note: string }
  | { kind: 'race_horizon'; name: string; days_away: number; tone: 'comfortable' | 'building' | 'tightening' | 'race_week'; coach_note: string }
  | { kind: 'recovery_amber'; hrv_ms: number | null; hrv_baseline_ms: number | null; rhr: number | null; concern: string; coach_note: string };

export interface TodayBriefing {
  voice: string;
  topics: TopicCard[];
  state: 'post-run' | 'pre-run' | 'rest' | 'skipped' | 'partial' | 'race-day' | 'cold-start';
  fromLLM: boolean;
  meta: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreateTokens: number; elapsedMs: number };
}

// ── State classification ──────────────────────────────────────────────

export function classifyState(s: TodayState): TodayBriefing['state'] {
  if (s.actualToday && s.todayDay && !s.todayDay.isRest && s.todayDay.distanceMi > 0) {
    const pct = s.actualToday.distanceMi / s.todayDay.distanceMi;
    if (pct >= 0.9) return 'post-run';
    if (pct >= 0.5) return 'partial';
    return 'skipped';
  }
  if (!s.todayDay || s.todayDay.isRest || s.todayDay.distanceMi === 0) return 'rest';
  return 'pre-run';
}

// ── User message construction ─────────────────────────────────────────

function fmtPace(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}/mi`;
}
function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`
    : `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}
function dowName(iso: string): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(iso + 'T12:00:00Z').getUTCDay()];
}
function dowShort(iso: string): string {
  return ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date(iso + 'T12:00:00Z').getUTCDay()];
}

export function buildUserMessage(s: TodayState, state: TodayBriefing['state']): string {
  const lines: string[] = [];

  // WHO + RACE
  lines.push(`RUNNER: ${s.runner.firstName}${s.runner.sex ? `, ${s.runner.sex}` : ''}${s.runner.age ? `, age ${s.runner.age}` : ''}.`);
  lines.push(s.nextRace ? `NEXT A-RACE: ${s.nextRace.name} in ${s.nextRace.daysAway} days.` : `NEXT A-RACE: none on calendar.`);
  lines.push('');

  // TIME
  const tod = s.localHour < 12 ? 'morning' : s.localHour < 17 ? 'afternoon' : s.localHour < 22 ? 'evening' : 'late night';
  lines.push(`READING NOW: ${dowName(s.today)} ${s.today}, ${tod} (local hour ${s.localHour}).`);
  if (s.actualToday?.startLocal) {
    const h = s.actualToday.startHourLocal;
    const runTod = h < 12 ? 'this morning' : h < 17 ? 'this afternoon' : 'this evening';
    lines.push(`RUN HAPPENED: ${runTod} (local hour ${h}). Reference the run by this time, not by when the runner is reading.`);
  }
  lines.push('');

  // PLAN vs ACTUAL
  if (s.todayDay && !s.todayDay.isRest && s.todayDay.distanceMi > 0) {
    lines.push(`PLAN FOR TODAY: ${s.todayDay.label} — ${s.todayDay.type}, ${s.todayDay.distanceMi} mi.`);
  } else lines.push(`PLAN FOR TODAY: rest day.`);

  if (s.actualToday) {
    const a = s.actualToday;
    lines.push(`ACTUAL: ${a.distanceMi.toFixed(2)} mi · ${fmtTime(a.movingTimeS)} · ${fmtPace(a.paceSPerMi)}` +
      (a.avgHr ? ` · avg HR ${a.avgHr}` : '') +
      (a.avgCadence ? ` · cadence ${Math.round(a.avgCadence)} spm` : ''));
  } else lines.push(`ACTUAL: nothing logged yet today.`);
  lines.push('');

  // WEEK
  lines.push(`THIS WEEK SO FAR: ${s.bankedMi.toFixed(1)} of ${s.currentWeek?.plannedMi ?? '?'} mi planned (${(s.currentWeek?.phase ?? 'BASE').toLowerCase()} phase week ${s.currentWeek?.idx != null ? s.currentWeek.idx + 1 : '?'})`);
  if (s.currentWeek?.days) {
    const upcoming = s.currentWeek.days.filter(d => d.date > s.today).map(d => {
      const day = dowShort(d.date);
      if (d.isRest || d.distanceMi === 0) return `${day} rest`;
      return `${day} ${d.type} ${d.distanceMi}mi`;
    });
    if (upcoming.length) lines.push(`REST OF THIS WEEK: ${upcoming.join(' · ')}`);
    else lines.push(`REST OF THIS WEEK: nothing — today is the last planned session of the week.`);
  }
  if (s.nextWorkout) {
    lines.push(`NEXT WORKOUT AFTER TODAY: ${s.nextWorkout.date} (${dowShort(s.nextWorkout.date)}) ${s.nextWorkout.type} ${s.nextWorkout.distanceMi}mi`);
  }
  lines.push('');

  if (s.lastWeekBankedMi != null) {
    lines.push(`LAST WEEK: ${Math.round(s.lastWeekBankedMi)} of ${s.prevWeek?.plannedMi ?? '?'} mi planned`);
    lines.push('');
  }

  // SLEEP
  if (s.sleepNights.length > 0) {
    lines.push(`SLEEP:`);
    lines.push(`  last night (${s.sleepNights[0].date}): ${s.sleepSummary.lastNightH?.toFixed(1)}h`);
    lines.push(`  last 7 nights: ${s.sleepNights.map(n => n.hours.toFixed(1) + 'h').join(' · ')}`);
    lines.push(`  7-night average: ${s.sleepSummary.avg7nH?.toFixed(1)}h (target ${s.sleepSummary.target_h}h)`);
    lines.push(`  cumulative deficit vs target: ${s.sleepSummary.deficit7nH?.toFixed(1)}h`);
    lines.push('');
  }

  // RECOVERY
  if (s.recovery.hrvMs || s.recovery.restingHrBpm) {
    const r: string[] = [];
    if (s.recovery.hrvMs) r.push(`HRV ${s.recovery.hrvMs.toFixed(0)}ms`);
    if (s.recovery.restingHrBpm) r.push(`resting heart rate ${s.recovery.restingHrBpm} bpm`);
    lines.push(`OTHER RECOVERY: ${r.join(' · ')}`);
    lines.push('');
  }

  // CADENCE BASELINE
  if (s.baselines.cadence60d && s.baselines.cadence60d.nDays >= 5) {
    const c = s.baselines.cadence60d;
    lines.push(`CADENCE BASELINE (this runner's last 60 days): mean ${c.mean.toFixed(0)} spm · range ${c.min.toFixed(0)}-${c.max.toFixed(0)} · ${c.nDays} runs`);
    lines.push('');
  }

  // WEIGHT
  if (s.weightRecent.length > 0) {
    lines.push(`WEIGHT (recent): ${s.weightRecent.map(w => `${w.date} ${w.lb.toFixed(1)}lb`).join(' · ')}`);
    lines.push('');
  }

  // CHECK-IN
  if (s.checkIn) {
    const ci: string[] = [];
    if (s.checkIn.energy != null) ci.push(`energy ${s.checkIn.energy}/5`);
    if (s.checkIn.soreness != null) ci.push(`soreness ${s.checkIn.soreness}/5`);
    if (s.checkIn.stress != null) ci.push(`stress ${s.checkIn.stress}/5`);
    if (ci.length) { lines.push(`CHECK-IN: ${ci.join(' · ')}`); lines.push(''); }
  }

  // DERIVED PROFILE
  const derived: string[] = [];
  if (s.derived.maxHr) derived.push(`Max HR: ${s.derived.maxHr} bpm (${s.derived.maxHrSource === 'manual' ? 'manually set' : 'observed peak'})`);
  if (s.derived.restingHr) derived.push(`Resting HR: ${s.derived.restingHr} bpm (${s.derived.restingHrSource === 'manual' ? 'manually set' : '60-day mean'})`);
  if (derived.length) {
    lines.push(`DERIVED PROFILE (already computed from runner's data — use these, don't ask the runner for them):`);
    derived.forEach(d => lines.push('  · ' + d));
    lines.push('');
  }

  // GAPS
  if (s.gaps.length > 0) {
    lines.push(`MISSING DATA (genuine gaps, not in any source. Emit a profile_gap topic for EACH. Do NOT emit profile_gap topics for HRmax/RHR/weight/age — those are derived):`);
    s.gaps.forEach(g => lines.push(`  · ${g.field} — ${g.impact}`));
    lines.push('');
  } else {
    lines.push(`MISSING DATA: none.`);
    lines.push('');
  }

  // ACTIVE INTENTS
  if (s.activeIntents.length > 0) {
    lines.push(`ACTIVE COACH INTENTS (commitments the runner made via cards. Reference these in voice when relevant; check if they landed when comparing to today's run):`);
    s.activeIntents.forEach(i => lines.push(`  · ${i.kind}: ${JSON.stringify(i.payload)}`));
    lines.push('');
  }

  // KNOWN TERMS (suppress repeat fun_facts)
  if (s.knownTerms.length > 0) {
    lines.push(`KNOWN TERMS (runner has already seen fun_fact cards for these — do NOT emit fun_fact topics for these terms): ${s.knownTerms.join(', ')}`);
    lines.push('');
  }

  // RESEARCH (inline, the coach cross-references)
  lines.push(`# RESEARCH RELEVANT TO TODAY'S DATA`);
  lines.push('');
  lines.push(`## Cadence (from Research/16-form-biomechanics.md)`);
  lines.push(`- The "180 spm" rule is a myth at universal-target level. Daniels' original observation was at sub-5:00/mile race pace on world-class athletes.`);
  lines.push(`- Heiderscheit (2011): bumping cadence 5% above preferred reduces knee energy absorption ~20%; 10% bump = ~34% reduction.`);
  lines.push(`- Cadence varies by leg length, pace, fatigue, footwear, surface.`);
  lines.push(`- Diagnostic rule: below 160 spm at easy pace for average-height runners (170-180cm) suggests overstriding. Below 155 at any pace = strong red flag. Tall runners (>185cm) run 5-8 spm lower than average.`);
  lines.push('');
  lines.push(`## Sleep + training`);
  lines.push(`- Adult endurance athletes need 7-9h sleep for full recovery + training to land. Multi-night deficit is the signal worth flagging, not one-off short nights.`);
  lines.push(`- HRV + resting HR drift up with accumulated sleep debt.`);
  lines.push('');
  lines.push(`## Week volume + plan adherence`);
  lines.push(`- 95-105% of planned weekly mileage is "on plan" — small under/over is normal training noise.`);
  lines.push(`- Quality day = where fitness gets MADE. Easy days = where recovery HAPPENS.`);
  lines.push('');

  // INSTRUCTION
  lines.push(`# YOUR JOB`);
  lines.push('');
  lines.push(`You are the coach. You have all the data above + relevant research. The runner is reading their TODAY page right now.`);
  lines.push('');
  lines.push(`Read everything. Form opinions. Decide what is worth saying TODAY. You're a real coach who looked at the screen and has thoughts — not a system reporting fields back.`);
  lines.push('');
  lines.push(`Write the coach's voice. Plain prose, paragraph breaks where natural. No headings, no bullets, no markdown.`);
  lines.push('');
  lines.push(`STATE: ${state.toUpperCase()}.`);

  return lines.join('\n');
}

// ── Card filter (render-time suppression) ─────────────────────────────

export function filterTopicsForRender(topics: TopicCard[], state: TodayState): TopicCard[] {
  return topics.filter((t) => {
    // cadence_experiment is suppressed when target_spm is null
    // (LLM kept the card but couldn't prescribe a target — defer to profile_gap)
    if (t.kind === 'cadence_experiment' && (t.target_spm == null || !Number.isFinite(t.target_spm))) {
      return false;
    }
    // profile_gap for fields that aren't actually missing (defensive — LLM shouldn't emit)
    if (t.kind === 'profile_gap' && !state.gaps.some((g) => g.field === t.field)) {
      return false;
    }
    // fun_fact for terms the runner has already seen
    if (t.kind === 'fun_fact' && state.knownTerms.includes(t.term)) {
      return false;
    }
    return true;
  });
}

// ── Main ──────────────────────────────────────────────────────────────

export async function generateTodayBriefing(state: TodayState): Promise<TodayBriefing> {
  const stateKind = classifyState(state);
  const userMessage = buildUserMessage(state, stateKind);
  const t0 = Date.now();
  const c = client();
  const response = await c.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1500,
    system: [{
      type: 'text',
      text: systemPrompt(),
      cache_control: { type: 'ephemeral' },
    }],
    messages: [{ role: 'user', content: userMessage }],
  });
  const raw = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  // Strip ```json fences if present
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = m ? m[1].trim() : raw;
  let parsed: { voice?: string; topics?: TopicCard[] };
  try { parsed = JSON.parse(jsonText); }
  catch (e) {
    throw new Error(`Coach LLM returned non-JSON for TodayBriefing: ${raw.slice(0, 300)}`);
  }
  const voice = typeof parsed.voice === 'string' ? parsed.voice.trim() : '';
  const topics = Array.isArray(parsed.topics) ? parsed.topics : [];
  const filteredTopics = filterTopicsForRender(topics, state);

  return {
    voice,
    topics: filteredTopics,
    state: stateKind,
    fromLLM: true,
    meta: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreateTokens: response.usage.cache_creation_input_tokens ?? 0,
      elapsedMs: Date.now() - t0,
    },
  };
}
