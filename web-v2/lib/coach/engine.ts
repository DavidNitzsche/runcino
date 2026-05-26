/**
 * Coach engine — the briefing pipeline.
 *
 *   1. Load state (state-loader)
 *   2. Resolve surface + mode + candidate topics (router)
 *   3. Filter candidates by prereqs (truth contract — no hallucination)
 *   4. Call Claude with the per-surface prompt + state + eligible topics
 *   5. Validate the response against the topic schemas
 *   6. Return { lead, voice, topics }
 *
 * Cache key: (user, date, latest_activity_id, latest_checkin_id, profile_hash).
 * Cache writes happen at the route handler boundary, not here.
 */
import Anthropic from '@anthropic-ai/sdk';
import { loadCoachState } from './state-loader';
import { resolveMode, type Surface } from './router';
import { TopicPrereqs, eligibleKinds, type Topic, type CoachState } from '@/lib/topics/types';
import { promptFor } from '@/coach/prompts';
import { computeReadiness, type ReadinessBreakdown } from './readiness';
import { signatureOf, readCachedBriefing, writeCachedBriefing } from './cache';
import { computeZones, zonesAsPromptText } from '@/lib/training/zones';

export interface BriefingResponse {
  surface: Surface;
  mode: string;
  lead: string;
  voice: string[];
  topics: Topic[];
  _state: {
    user_id: string;
    today: string;
    candidateKinds: string[];
    eligibleKinds: string[];
    // Glance metrics — used by web-companion MicroStatStrip and watch glance.
    weekDone: number;
    weekPlanned: number | null;
    phaseLabel: string | null;
    sleep7Avg: number | null;
    sleep7Deficit: number;
    rhrCurrent: number | null;
    rhrBaseline: number | null;
    cadenceBaseline: number | null;
    nextARaceName: string | null;
    daysToARace: number | null;
    readiness: ReadinessBreakdown;
  };
}

export async function generateBriefing(userId: string, surface: Surface, raceSlug?: string): Promise<BriefingResponse> {
  const state = await loadCoachState(userId);
  const resolved = resolveMode(surface, state, raceSlug);
  const eligible = eligibleKinds(state, resolved.candidateTopics);

  // Cache layer — read first. Voice only regenerates when state inputs change.
  const sig = signatureOf(state, raceSlug);
  const cached = await readCachedBriefing(userId, surface, sig);
  if (cached) {
    return {
      surface: cached.surface,
      mode: cached.mode,
      lead: cached.lead,
      voice: cached.voice,
      topics: cached.topics,
      _state: {
        ...cached._state,
        // Always re-compute readiness from fresh state (cheap, no LLM)
        readiness: computeReadiness(state),
      },
    };
  }

  const systemPrompt = promptFor(resolved.surface, resolved.mode);
  const userMessage = buildUserMessage(state, resolved, eligible);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1800,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMessage }],
  });

  const raw = resp.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n')
    .trim();

  const parsed = parseLLMOutput(raw);

  // Belt + suspenders: even if the LLM emits a topic kind we didn't shortlist,
  // drop it. This is the second line of the truth-contract defense.
  const validatedTopics: Topic[] = (parsed.topics ?? []).filter((t: Topic) =>
    eligible.includes(t.kind as any) && TopicPrereqs[t.kind](state)
  );

  // Server-side enrichment: inject deterministic ids + NUMBERS the LLM can't
  // be trusted to repeat. The LLM authors voice; values come from state.
  for (const t of validatedTopics) {
    const p = t.payload as any;
    if (t.kind === 'run_recap' && state.latest_activity?.id) {
      p.activity_id = state.latest_activity.id;
    }
    if (t.kind === 'sleep_deficit') {
      if (state.sleep7Avg != null) p.avg_h_7n = state.sleep7Avg;
      p.deficit_h_7n = state.sleep7Deficit ?? 0;
    }
  }

  // Drop profile_gap topics with no actionable field — better silent than
  // a broken card. (LLM occasionally emits empty payloads.)
  const filtered = validatedTopics.filter((t) => {
    if (t.kind === 'profile_gap') {
      const f = ((t.payload as any)?.field ?? '').trim();
      return f.length > 0;
    }
    return true;
  });

  const response: BriefingResponse = {
    surface: resolved.surface,
    mode: resolved.mode,
    lead: parsed.lead ?? '',
    voice: parsed.voice ?? [],
    topics: filtered,
    _state: {
      user_id: userId,
      today: state.today,
      candidateKinds: resolved.candidateTopics,
      eligibleKinds: eligible,
      weekDone: state.weekDone,
      weekPlanned: state.weekPlanned,
      phaseLabel: state.phaseLabel,
      sleep7Avg: state.sleep7Avg,
      sleep7Deficit: state.sleep7Deficit,
      rhrCurrent: state.rhrCurrent,
      rhrBaseline: state.rhrBaseline,
      cadenceBaseline: state.cadenceBaseline,
      nextARaceName: state.nextARace?.name ?? null,
      daysToARace: state.nextARace?.days_to_race ?? null,
      readiness: computeReadiness(state),
    },
  };

  // Persist to cache so the next request with same signature is instant.
  await writeCachedBriefing(userId, surface, sig, resolved.mode, response as any);

  return response;
}

function buildUserMessage(state: CoachState, resolved: ReturnType<typeof resolveMode>, eligible: string[]): string {
  const lines: string[] = [];
  lines.push(`RUNNER: ${state.profile?.full_name ?? 'David'}.`);
  lines.push(`TODAY: ${state.today} (${dayOfWeekName(state.today)}).`);
  lines.push(`SURFACE: ${resolved.surface} · MODE: ${resolved.mode}.`);
  lines.push('');

  // HR ZONES — use LTHR-anchored (Friel) when available; %MHR fallback otherwise.
  // This is the foundation for the coach reasoning about effort correctly.
  // Cite: Research/03-heart-rate-zones.md §6.
  const zones = computeZones({ lthr: state.profile?.lthr ?? null, maxHr: state.profile?.hrmax ?? null });
  if (zones) {
    lines.push(zonesAsPromptText(zones));
    lines.push('');
  }
  if (state.profile?.experience_level) {
    lines.push(`EXPERIENCE: ${state.profile.experience_level.replace('_', '+')} — calibrate volume expectations accordingly.`);
    lines.push('');
  }

  if (state.latest_activity) {
    const a = state.latest_activity;
    lines.push(`LATEST RUN (${a.date} = ${dayOfWeekName(a.date)}): ${a.mi.toFixed(1)}mi · pace ${a.pace ?? '—'} · HR ${a.hr ?? '—'} · cad ${a.cadence ?? '—'}${a.name ? ' · "' + a.name + '"' : ''}`);
  }
  lines.push(`WEEK: ${state.weekDone}mi done / ${state.weekPlanned ?? '?'}mi planned${state.phaseLabel ? ' · phase ' + state.phaseLabel : ''}`);
  if (state.nextWorkout) {
    const n = state.nextWorkout;
    lines.push(`NEXT WORKOUT: ${n.date} (${dayOfWeekName(n.date)}) ${n.type} ${n.mi}mi${n.label ? ' · ' + n.label : ''}`);
  }
  if (state.nextARace) {
    // Include explicit date AND month name so the LLM can't mis-narrate it.
    const monthName = MONTH_NAMES[new Date(state.nextARace.date + 'T12:00:00Z').getUTCMonth()];
    lines.push(`A-RACE: ${state.nextARace.name} on ${state.nextARace.date} (${monthName} ${new Date(state.nextARace.date + 'T12:00:00Z').getUTCDate()}) — ${state.nextARace.days_to_race} days away · goal ${state.nextARace.goal ?? '—'}`);
    lines.push(`  ↳ Use ${monthName} in any month references. Do NOT invent a different month.`);
  }
  lines.push(`SLEEP: 7n avg ${state.sleep7Avg ?? '—'}h · deficit ${state.sleep7Deficit}h`);
  if (state.rhrCurrent != null) {
    const delta = state.rhrBaseline != null ? state.rhrCurrent - state.rhrBaseline : null;
    lines.push(`RHR: current ${state.rhrCurrent} · baseline ${state.rhrBaseline ?? '—'}${delta != null ? ' · delta ' + (delta >= 0 ? '+' : '') + delta : ''}`);
  }
  if (state.hrvCurrent != null) {
    lines.push(`HRV: current ${state.hrvCurrent}ms · 30d baseline ${state.hrvBaseline ?? '—'}`);
  }
  lines.push(`CADENCE: 60d baseline ${state.cadenceBaseline ?? '—'} spm`);
  lines.push('');
  lines.push(`PROFILE FIELDS:`);
  lines.push(`  height_cm: ${state.profile?.height_cm ?? 'MISSING'}`);
  lines.push('');
  if (state.pendingIntents.length) {
    lines.push(`PENDING INTENTS (acknowledge ONCE in voice, then move on):`);
    for (const i of state.pendingIntents) {
      lines.push(`  · ${i.reason}: ${i.field} = ${i.value}`);
    }
    lines.push('');
  }
  if (state.recentCheckIns.length) {
    lines.push(`RECENT CHECK-INS (runner's own rating — do NOT make these up if none exist):`);
    for (const c of state.recentCheckIns.slice(0, 3)) {
      lines.push(`  · ${c.ts} → ${c.rating.toUpperCase()}`);
    }
    lines.push('');
  } else {
    lines.push(`RECENT CHECK-INS: none. The runner has NOT tapped SOLID/TIRED/WRECKED today or this week. Do NOT claim they did.`);
    lines.push('');
  }
  lines.push(`ELIGIBLE TOPIC KINDS (prereqs met — emit ONLY these as cards):`);
  lines.push(`  ${eligible.join(', ')}`);
  lines.push('');
  lines.push(`# YOUR JOB`);
  lines.push(`Coach voice for this surface + mode per the prompt above. Return strict JSON: {lead, voice: string[], topics: Topic[]}. NO markdown fences.`);
  return lines.join('\n');
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function dayOfWeekName(iso: string): string {
  return DOW_NAMES[new Date(iso + 'T12:00:00Z').getUTCDay()];
}

function parseLLMOutput(raw: string): { lead?: string; voice?: string[]; topics?: Topic[] } {
  // Strip code fences if present.
  let s = raw;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  else {
    const first = raw.indexOf('{');
    const last  = raw.lastIndexOf('}');
    if (first >= 0 && last > first) s = raw.slice(first, last + 1);
  }
  try { return JSON.parse(s); } catch { return {}; }
}
