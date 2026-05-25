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

  // Server-side enrichment: inject deterministic ids the LLM can't be trusted
  // to repeat. run_recap gets the real activity_id so the card can route to
  // /runs/[id] without round-tripping through the model.
  for (const t of validatedTopics) {
    if (t.kind === 'run_recap' && state.latest_activity?.id) {
      (t.payload as any).activity_id = state.latest_activity.id;
    }
  }

  return {
    surface: resolved.surface,
    mode: resolved.mode,
    lead: parsed.lead ?? '',
    voice: parsed.voice ?? [],
    topics: validatedTopics,
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
}

function buildUserMessage(state: CoachState, resolved: ReturnType<typeof resolveMode>, eligible: string[]): string {
  const lines: string[] = [];
  lines.push(`RUNNER: ${state.profile?.full_name ?? 'David'}.`);
  lines.push(`TODAY: ${state.today}.`);
  lines.push(`SURFACE: ${resolved.surface} · MODE: ${resolved.mode}.`);
  lines.push('');
  if (state.latest_activity) {
    const a = state.latest_activity;
    lines.push(`LATEST RUN (${a.date}): ${a.mi.toFixed(1)}mi · pace ${a.pace ?? '—'} · HR ${a.hr ?? '—'} · cad ${a.cadence ?? '—'}${a.name ? ' · "' + a.name + '"' : ''}`);
  }
  lines.push(`WEEK: ${state.weekDone}mi done / ${state.weekPlanned ?? '?'}mi planned${state.phaseLabel ? ' · phase ' + state.phaseLabel : ''}`);
  if (state.nextWorkout) {
    const n = state.nextWorkout;
    lines.push(`NEXT WORKOUT: ${n.date} ${n.type} ${n.mi}mi${n.label ? ' · ' + n.label : ''}`);
  }
  if (state.nextARace) {
    lines.push(`A-RACE: ${state.nextARace.name} in ${state.nextARace.days_to_race} days · goal ${state.nextARace.goal ?? '—'}`);
  }
  lines.push(`SLEEP: 7n avg ${state.sleep7Avg ?? '—'}h · deficit ${state.sleep7Deficit}h`);
  if (state.rhrCurrent != null) {
    lines.push(`RHR: current ${state.rhrCurrent} · 14d baseline ${state.rhrBaseline ?? '—'}`);
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
    lines.push(`RECENT CHECK-INS (runner's voice):`);
    for (const c of state.recentCheckIns.slice(0, 3)) {
      lines.push(`  · ${c.ts} → ${c.rating.toUpperCase()}`);
    }
    lines.push('');
  }
  lines.push(`ELIGIBLE TOPIC KINDS (prereqs met — emit ONLY these as cards):`);
  lines.push(`  ${eligible.join(', ')}`);
  lines.push('');
  lines.push(`# YOUR JOB`);
  lines.push(`Coach voice for this surface + mode per the prompt above. Return strict JSON: {lead, voice: string[], topics: Topic[]}. NO markdown fences.`);
  return lines.join('\n');
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
