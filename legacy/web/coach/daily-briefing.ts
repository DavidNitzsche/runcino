/**
 * daily-briefing · LLM-driven coach voice for the /overview TODAY page.
 *
 * Replaces the deterministic template generator (lib/coach-briefing.ts)
 * for the POST-RUN state where the coach has real signal to interpret.
 * Other states still fall back to the template generator for now (see
 * docs/COACH_TODAY_SPEC.md §9 — those land in subsequent commits).
 *
 * Voice doctrine lives in web/coach/prompts/daily-briefing.md (anchored
 * to David's gold sample). All state is passed in as a structured input
 * — the function builds the user message, the LLM produces the prose.
 *
 * Caching: keyed on (userId, today, latestActivityId) via the
 * coach_today_cache table. A new run logged invalidates by changing
 * latestActivityId. A check-in update invalidates by passing
 * `bustCache: true`. Day flip naturally invalidates by changing today.
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlanWeek, PlanWeekDay } from '@/lib/synthetic-plan';
import type { NotableThing } from '@/lib/notable-thing';

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

export function llmBriefingAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// ── State input ──────────────────────────────────────────────────────

export interface DailyBriefingState {
  /** Runner identity. Used in voice — first name is conversational. */
  runner: { firstName: string };

  /** Today's date in the runner's local timezone (YYYY-MM-DD). */
  today: string;
  /** Local hour 0-23 — drives time-of-day voice variation. */
  localHour: number;

  /** Today's planned workout, or null on rest days. */
  plannedToday: PlanWeekDay | null;

  /** Today's actual run if completed (>= 60% of planned distance, matching
   *  the isComplete rule). null if not started or skipped. */
  actualToday: {
    distanceMi: number;
    movingTimeS: number;
    paceSPerMi: number;
    avgHr: number | null;
    avgCadence: number | null;
    name: string | null;
  } | null;

  /** The one notable thing the coach should mention about today's run.
   *  null when nothing notable; coach falls back to week-shape voice. */
  notable: NotableThing | null;

  /** Conditions for today's run. */
  weather: {
    tempF: number | null;
    humidityPct: number | null;
    isHot?: boolean;
  } | null;

  /** This week's plan + actuals so far. */
  thisWeek: {
    phase: string;       // 'BASE' / 'BUILD' / 'PEAK' / 'TAPER' / 'RACE_WEEK'
    phaseWeekIdx: number; // 1-based position within the phase
    plannedMi: number;
    /** Mileage banked through today inclusive. */
    bankedMi: number;
    /** Set true when the dedup pipeline has flagged the banked number as
     *  unreliable. Coach speaks qualitatively when true. */
    bankedReliable: boolean;
    /** Plan days for the rest of the week — coach can name what's coming. */
    upcoming: PlanWeekDay[];
  };

  /** Previous week summary (mostly for Monday voice). null if none. */
  lastWeek: {
    plannedMi: number;
    ranMi: number;
    longestMi: number | null;
    longestPaceSPerMi: number | null;
  } | null;

  /** The runner's next A-race. null when none in window. */
  nextRace: { name: string; daysAway: number } | null;

  /** Recovery signals (used selectively, not recited). */
  recovery: {
    sleepHoursLastNight: number | null;
    hrvMs: number | null;
    hrvBaselineMs: number | null;
    restingHrBpm: number | null;
    restingHrBaselineBpm: number | null;
  } | null;

  /** Runner check-in for today (1-5 each, 5 best). */
  checkIn: {
    energy: number | null;
    soreness: number | null;
    stress: number | null;
  } | null;

  /** Coach mode override (when active). Affects voice register. */
  mode: 'normal' | 'race_week' | 'race_day' | 'post_race' | 'injured' | 'sick' | 'rebuild' | 'cold_start';
}

export interface DailyBriefingResult {
  /** The coach's prose. Multi-paragraph separated by '\n\n'. */
  text: string;
  /** Tag for which state branch the caller hit (used for diagnostics + UI cues). */
  state: 'post-run' | 'pre-run' | 'rest' | 'skipped' | 'partial' | 'race-day' | 'cold-start';
  /** True when LLM produced this; false when fallen back to a stub. */
  fromLLM: boolean;
  /** Round-trip cost / latency for observability. */
  meta?: {
    inputTokens?: number;
    outputTokens?: number;
    elapsedMs?: number;
  };
}

// ── State classification ─────────────────────────────────────────────

export function classifyState(s: DailyBriefingState): DailyBriefingResult['state'] {
  if (s.mode === 'race_day') return 'race-day';
  if (s.mode === 'cold_start') return 'cold-start';
  // Today completed?
  if (s.actualToday && s.plannedToday && !s.plannedToday.isRest && s.plannedToday.distanceMi > 0) {
    const pct = s.actualToday.distanceMi / s.plannedToday.distanceMi;
    if (pct >= 0.9) return 'post-run';
    if (pct >= 0.5) return 'partial';
    return 'skipped';
  }
  // No actual but planned was a rest?
  if (!s.plannedToday || s.plannedToday.isRest || s.plannedToday.distanceMi === 0) return 'rest';
  // Pre-run (workout planned, not started)
  return 'pre-run';
}

// ── Render helpers ───────────────────────────────────────────────────

function fmtPace(sPerMi: number): string {
  const m = Math.floor(sPerMi / 60);
  const s = Math.round(sPerMi % 60);
  return `${m}:${String(s).padStart(2, '0')}/mi`;
}

function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

function dowName(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()];
}

// ── User message construction ────────────────────────────────────────

function buildUserMessage(s: DailyBriefingState, state: DailyBriefingResult['state']): string {
  const lines: string[] = [];

  // RUNNER + RACE CONTEXT
  lines.push(`RUNNER: ${s.runner.firstName}.`);
  if (s.nextRace) lines.push(`NEXT A-RACE: ${s.nextRace.name} in ${s.nextRace.daysAway} days.`);
  else lines.push(`NEXT A-RACE: none on the calendar.`);
  lines.push('');

  // TIME + DAY
  const tod = s.localHour < 12 ? 'morning' : s.localHour < 17 ? 'afternoon' : s.localHour < 22 ? 'evening' : 'late night';
  lines.push(`TODAY: ${dowName(s.today)}, ${s.today}, ${tod} (local hour ${s.localHour}).`);
  lines.push('');

  // PLAN FOR TODAY
  if (s.plannedToday && !s.plannedToday.isRest && s.plannedToday.distanceMi > 0) {
    lines.push(`PLAN FOR TODAY: ${s.plannedToday.label} — ${s.plannedToday.type}, ${s.plannedToday.distanceMi} mi.`);
  } else {
    lines.push(`PLAN FOR TODAY: rest day.`);
  }

  // ACTUAL
  if (s.actualToday) {
    lines.push(`ACTUAL: ${s.actualToday.distanceMi.toFixed(2)} mi · ${fmtTime(s.actualToday.movingTimeS)} · ${fmtPace(s.actualToday.paceSPerMi)}` +
      (s.actualToday.avgHr ? ` · avg HR ${s.actualToday.avgHr}` : '') +
      (s.actualToday.avgCadence ? ` · cadence ${Math.round(s.actualToday.avgCadence)} spm` : ''));
  } else {
    lines.push(`ACTUAL: nothing logged yet today.`);
  }
  lines.push('');

  // NOTABLE THING — give the coach the pre-picked observation if any
  if (s.notable) {
    lines.push(`COACH OBSERVATION TO MENTION (the ONE thing worth saying about this run): ${s.notable.text}`);
    lines.push('');
  } else if (state === 'post-run' || state === 'partial') {
    lines.push(`COACH OBSERVATION: nothing notable in the run data — talk meta-pattern or week shape instead.`);
    lines.push('');
  }

  // CONDITIONS
  if (s.weather && (s.weather.tempF != null || s.weather.humidityPct != null)) {
    lines.push(`CONDITIONS: ${s.weather.tempF != null ? Math.round(s.weather.tempF) + '°F' : ''}` +
      (s.weather.humidityPct != null ? ` · ${Math.round(s.weather.humidityPct)}% humidity` : '') +
      (s.weather.isHot ? ' · flagged warm' : ''));
    lines.push('');
  }

  // WEEK PROGRESS
  const weekLine = s.thisWeek.bankedReliable
    ? `${s.thisWeek.bankedMi.toFixed(1)} of ${s.thisWeek.plannedMi} mi (${s.thisWeek.phase.toLowerCase()} week ${s.thisWeek.phaseWeekIdx})`
    : `well over plan this week (data note: dedup pipeline flagged mileage as unreliable — speak qualitatively about volume, not numerically). Phase: ${s.thisWeek.phase.toLowerCase()} week ${s.thisWeek.phaseWeekIdx}.`;
  lines.push(`THIS WEEK SO FAR: ${weekLine}`);

  // UPCOMING (rest of week)
  if (s.thisWeek.upcoming.length > 0) {
    const upcomingStr = s.thisWeek.upcoming.map(d => {
      const day = dowName(d.date).slice(0, 3);
      if (d.isRest || d.distanceMi === 0) return `${day} rest`;
      return `${day} ${d.type} ${d.distanceMi}mi`;
    }).join(' · ');
    lines.push(`UPCOMING THIS WEEK: ${upcomingStr}`);
  }
  lines.push('');

  // LAST WEEK
  if (s.lastWeek) {
    lines.push(`LAST WEEK: ran ${Math.round(s.lastWeek.ranMi)} of ${s.lastWeek.plannedMi} mi planned` +
      (s.lastWeek.longestMi ? ` · longest ${s.lastWeek.longestMi}mi at ${s.lastWeek.longestPaceSPerMi ? fmtPace(s.lastWeek.longestPaceSPerMi) : '?'}` : ''));
    lines.push('');
  }

  // RECOVERY
  if (s.recovery) {
    const rec: string[] = [];
    if (s.recovery.sleepHoursLastNight != null) rec.push(`sleep ${s.recovery.sleepHoursLastNight.toFixed(1)}h`);
    if (s.recovery.hrvMs != null && s.recovery.hrvBaselineMs != null) {
      const delta = s.recovery.hrvMs - s.recovery.hrvBaselineMs;
      rec.push(`HRV ${s.recovery.hrvMs.toFixed(0)} vs baseline ${s.recovery.hrvBaselineMs.toFixed(0)} (${delta >= 0 ? '+' : ''}${delta.toFixed(0)})`);
    }
    if (s.recovery.restingHrBpm != null) rec.push(`RHR ${s.recovery.restingHrBpm}`);
    if (rec.length) {
      lines.push(`RECOVERY: ${rec.join(' · ')}`);
      lines.push('');
    }
  }

  // CHECK-IN
  if (s.checkIn) {
    const ci: string[] = [];
    if (s.checkIn.energy != null) ci.push(`energy ${s.checkIn.energy}/5`);
    if (s.checkIn.soreness != null) ci.push(`soreness ${s.checkIn.soreness}/5`);
    if (s.checkIn.stress != null) ci.push(`stress ${s.checkIn.stress}/5`);
    if (ci.length) {
      lines.push(`CHECK-IN: ${ci.join(' · ')}`);
      lines.push('');
    }
  }

  // INSTRUCTION
  lines.push(`STATE: ${state.toUpperCase()}. Write the coach's voice for the TODAY page. Plain prose, paragraph breaks where natural. No headings.`);

  return lines.join('\n');
}

// ── Main entry ───────────────────────────────────────────────────────

export async function generateDailyBriefing(state: DailyBriefingState): Promise<DailyBriefingResult> {
  const stateKind = classifyState(state);
  const userMessage = buildUserMessage(state, stateKind);
  const t0 = Date.now();
  const c = client();
  const response = await c.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    system: [{
      type: 'text',
      text: systemPrompt(),
      cache_control: { type: 'ephemeral' },
    }],
    messages: [{ role: 'user', content: userMessage }],
  });
  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text.trim())
    .join('\n\n')
    .trim();
  return {
    text,
    state: stateKind,
    fromLLM: true,
    meta: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      elapsedMs: Date.now() - t0,
    },
  };
}
