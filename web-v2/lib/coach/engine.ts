/**
 * Coach engine — Anthropic tool-use loop.
 *
 * The coach DOES NOT receive pre-extracted facts in the user message.
 * The user message contains only ORIENTATION (who, when, what surface,
 * which topic kinds are eligible). The coach calls tools to read data
 * from the runner's sources (plan, runs, profile, zones, races, etc.)
 * and composes voice from results.
 *
 * After the LLM responds with prose, the server populates ALL numeric
 * topic fields from the same data sources. The LLM never writes a number
 * into a UI card.
 *
 * Cache is event-driven (not signature-hashed) — briefings are pre-built
 * on triggers (day rollover, run ingest, check-in, profile edit, plan
 * swap, race edit) and read forever until the next bust.
 */
import Anthropic from '@anthropic-ai/sdk';
import { loadCoachState } from './state-loader';
import { resolveMode, type Surface } from './router';
import { TopicPrereqs, eligibleKinds, type Topic } from '@/lib/topics/types';
import { promptFor } from '@/coach/prompts';
import { computeReadiness, type ReadinessBreakdown } from './readiness';
import { readCachedBriefing, writeCachedBriefing } from './cache';
import { TOOLS, dispatchTool } from './tools';
import { emptyUsage, addRound, recordUsage } from './usage';

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
    /** Tool calls the coach made while composing this briefing.
     *  Used to verify the coach is actually reading via tools, not
     *  free-wheeling. Survives the cache so probing /api/briefing shows
     *  what it called last time. */
    toolTrace?: Array<{ name: string; input: any }>;
  };
}

const DOW_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function dayOfWeekName(iso: string): string {
  return DOW_NAMES[new Date(iso + 'T12:00:00Z').getUTCDay()];
}

export async function generateBriefing(
  userId: string,
  surface: Surface,
  raceSlug?: string,
  compact?: boolean,
): Promise<BriefingResponse> {
  // State-loader still runs to: (a) resolve mode + eligible topics,
  // (b) compute readiness for the response envelope, (c) populate
  // numeric topic fields after the LLM is done. The COACH never sees
  // any of state directly — it reads via tools.
  const state = await loadCoachState(userId);
  const resolved = resolveMode(surface, state, raceSlug);
  const eligible = eligibleKinds(state, resolved.candidateTopics);

  // Event-driven cache: if a briefing exists for (user, surface, client),
  // return it. Mutating endpoints call bustBriefingCache to invalidate.
  const cacheKey = compact ? `${surface}:ios` : surface;
  const cached = await readCachedBriefing(userId, cacheKey);
  if (cached) {
    return {
      ...(cached as any),
      _state: {
        ...(cached as any)._state,
        readiness: computeReadiness(state),
      },
    };
  }

  // ── PAUSE KILL-SWITCH (P43) ──────────────────────────────────────
  // When COACH_PAUSED=1 is set in env, NEVER call the LLM. Return a
  // stub briefing so the UI doesn't error. Cache is also NOT written
  // (so as soon as the flag clears, the next request fully regenerates).
  // The cron jobs also skip when this is on.
  //
  // Used to freeze spend while reviewing notes, doing migrations,
  // debugging, or whenever you want zero LLM activity. Flip the env
  // var off to resume.
  if (process.env.COACH_PAUSED === '1') {
    return {
      surface: resolved.surface,
      mode: resolved.mode,
      lead: 'Coach paused',
      // voice MUST be an array of paragraph strings — the client renders
      // it with .map(). Bug: was a single string here and crashed /today.
      voice: [
        'The coach is paused while you review notes.',
        'No LLM calls are firing — flip the COACH_PAUSED env var off in Railway to resume.',
      ],
      topics: [],
      _state: {
        today: state.today,
        readiness: computeReadiness(state),
        toolTrace: [],
      },
    } as any as BriefingResponse;
  }

  // Build the system prompt + tool-use loop
  const systemPrompt = systemPromptFor(resolved.surface, resolved.mode, compact);
  const orientationMessage = buildOrientationMessage({
    runner: state.profile?.full_name ?? 'David',
    today: state.today,
    surface: resolved.surface,
    mode: resolved.mode,
    eligibleKinds: eligible,
    compact,
  });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: orientationMessage },
  ];

  // Tool-use loop — coach calls tools until it returns end_turn with prose.
  // Hard cap at 8 iterations to prevent runaways; in practice we expect 3-5.
  //
  // tool_choice strategy:
  //   - First turn: 'any' — model MUST call at least one tool. Without this,
  //     Sonnet's default 'auto' lets it skip tools entirely and fabricate
  //     numbers (observed empirically — empty trace + hallucinated runs).
  //   - Subsequent turns: 'auto' — model can keep calling tools OR end the
  //     turn with prose once it's read enough.
  const model = 'claude-sonnet-4-5-20250929';
  const usageAcc = emptyUsage();
  let finalContent: Anthropic.ContentBlock[] = [];
  const toolTrace: Array<{ name: string; input: any }> = [];
  const stopReasons: string[] = [];
  for (let i = 0; i < 8; i++) {
    const resp = await client.messages.create({
      model,
      max_tokens: 2400,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      tool_choice: i === 0 ? { type: 'any' } : { type: 'auto' },
      messages,
    });
    // P43 — accumulate token usage for spend tracking
    addRound(usageAcc, resp.usage);
    stopReasons.push(resp.stop_reason ?? 'null');

    if (resp.stop_reason === 'end_turn' || resp.stop_reason === 'max_tokens') {
      finalContent = resp.content;
      break;
    }

    if (resp.stop_reason === 'tool_use') {
      // Dispatch every tool_use block in this turn, append results, loop.
      const toolUseBlocks = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      const results = await Promise.all(
        toolUseBlocks.map(async (b) => {
          toolTrace.push({ name: b.name, input: b.input });
          try {
            const out = await dispatchTool(b.name, userId, b.input as any);
            return { type: 'tool_result' as const, tool_use_id: b.id, content: JSON.stringify(out) };
          } catch (e: any) {
            return { type: 'tool_result' as const, tool_use_id: b.id, content: JSON.stringify({ error: e.message ?? String(e) }), is_error: true };
          }
        })
      );
      messages.push({ role: 'assistant', content: resp.content });
      messages.push({ role: 'user', content: results });
      continue;
    }

    // Unknown stop reason — keep what we got and break.
    finalContent = resp.content;
    break;
  }

  // Trace tool usage to server logs so we can verify the coach is actually
  // reading from sources (and not skipping critical reads like getPlanWindow
  // for a pre-run brief). Visible in Railway logs AND attached to the response
  // under _state.toolTrace so the API can be probed directly during iteration.
  console.log('[coach] stop_reasons:', stopReasons.join(','), 'tool trace:', JSON.stringify(toolTrace));

  const rawText = finalContent
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  const parsed = parseLLMOutput(rawText);

  // Validate topics against eligibility + prereqs (truth-contract belt).
  const validatedTopics: Topic[] = (parsed.topics ?? []).filter((t: Topic) =>
    eligible.includes(t.kind as any) && TopicPrereqs[t.kind]?.(state)
  );

  // Server-side topic enrichment — populate ALL numeric/structural fields
  // from state. The LLM only authors `coach_note` (prose). Even if it tried
  // to write a number into a card payload, we overwrite from state here so
  // the UI is correct by construction.
  for (const t of validatedTopics) {
    // Topic payloads are populated server-side; LLM emits { kind, coach_note }.
    // The Topic union has typed payloads per kind, but server is the source
    // of truth for those fields, so cast through any here.
    if ((t as any).payload == null) (t as any).payload = {};
    const p = (t as any).payload;
    if (t.kind === 'run_recap' && state.latest_activity?.id) {
      p.activity_id = state.latest_activity.id;
    }
    if (t.kind === 'sleep_deficit') {
      if (state.sleep7Avg != null) p.avg_h_7n = state.sleep7Avg;
      p.deficit_h_7n = state.sleep7Deficit ?? 0;
    }
    if (t.kind === 'next_workout' && state.nextWorkout) {
      const nw = state.nextWorkout;
      const d = new Date(nw.date + 'T12:00:00Z');
      const tomorrowIso = new Date(Date.parse(state.today + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
      const isTomorrow = nw.date === tomorrowIso;
      p.dow = isTomorrow ? 'TOMORROW' : DOW_NAMES[d.getUTCDay()].toUpperCase();
      p.type = nw.type;
      p.label = nw.label ?? nw.type;
      p.mi = nw.mi;
    }
    if (t.kind === 'race_horizon' && state.nextARace) {
      const r = state.nextARace;
      p.race_name = r.name;
      p.race_date = r.date;
      p.days_to_race = r.days_to_race;
      p.goal = r.goal;
      p.tone = r.days_to_race <= 7 ? 'race_week'
        : r.days_to_race <= 21 ? 'sharpening' : 'building';
    }
  }

  // Drop topics that would duplicate other surfaces (run_recap on /today
  // when today's run is already shown on the left rail, etc.)
  const filtered = validatedTopics.filter((t) => {
    if (t.kind === 'profile_gap') {
      const f = ((t.payload as any)?.field ?? '').trim();
      return f.length > 0;
    }
    if (t.kind === 'run_recap' && resolved.surface === 'today') {
      const a = state.latest_activity;
      if (a && a.date === state.today && a.mi >= 0.5) return false;
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
      toolTrace,
    },
  };

  await writeCachedBriefing(userId, cacheKey, resolved.mode, response as any);

  // P43 — log token usage + cost. Fire-and-forget; don't block the
  // briefing on the insert. recordUsage swallows its own errors.
  void recordUsage({
    userId,
    surface,
    mode: resolved.mode,
    compact,
    model,
    usage: usageAcc,
  });

  return response;
}

// ── Orientation-only user message ───────────────────────────────────────
//
// This is the ONLY thing the coach gets at the start. No facts, no values,
// no pre-extracted "TODAY'S WORKOUT" or "RECENT RUNS" dumps. The coach
// uses TOOLS to read those.

interface OrientationInput {
  runner: string;
  today: string;
  surface: Surface;
  mode: string;
  eligibleKinds: string[];
  compact?: boolean;
}

function buildOrientationMessage(o: OrientationInput): string {
  const lines: string[] = [];
  lines.push(`RUNNER: ${o.runner}.`);
  lines.push(`TODAY: ${o.today} (${dayOfWeekName(o.today)}). The training week runs Monday→Sunday.`);
  lines.push(`SURFACE: ${o.surface} · MODE: ${o.mode}.`);
  lines.push('');
  lines.push(`# READ FIRST, COMPOSE SECOND`);
  lines.push(
    `You have ZERO data about this runner in this message. Every number, ` +
    `every workout, every day-of-week alignment must come from a tool call. ` +
    `If you write a number that didn't come from a tool, you fabricated it.`,
  );
  lines.push('');
  lines.push(`# TRUTH CONTRACT`);
  lines.push(
    `- Only narrate runs that getRuns returns. Never invent "Sunday's long run" ` +
    `or "Friday's 7-miler" — call getRuns and use ONLY what it gives you. If ` +
    `getRuns returns 1 run, you can only mention 1 run.`,
  );
  lines.push(
    `- To know what TODAY's planned session is: getPlanWindow({ daysBack: 0, daysForward: 6 }). ` +
    `Find the row whose date matches TODAY (above). That row IS today's session. ` +
    `Don't infer "today must be easy" from yesterday's run.`,
  );
  lines.push(
    `- Only claim a check-in rating (SOLID/TIRED/WRECKED) that appears in getCheckIns. ` +
    `If empty, do NOT say "you said you were tired" — they didn't say anything.`,
  );
  lines.push(
    `- HR zones, paces, and physiological framing must come from getZones + getDoctrine. ` +
    `Don't invent thresholds.`,
  );
  lines.push(
    `- If today's session type from getPlanWindow is threshold/intervals/tempo/long, ` +
    `ALSO call getDoctrine({ topic: <type> }) before writing voice. Frame the session ` +
    `from doctrine, not generic running knowledge.`,
  );
  lines.push('');
  lines.push(`# ELIGIBLE TOPIC KINDS`);
  lines.push(`Emit ONLY these as cards (others are dropped): ${o.eligibleKinds.join(', ') || '(none)'}`);
  lines.push('');
  lines.push(`# OUTPUT`);
  lines.push(
    `Return strict JSON in your final message (after any tool calls): ` +
    `{lead, voice: string[], topics: Topic[]}. NO markdown fences. ` +
    `Topics carry { kind, coach_note } only — the server populates numeric fields ` +
    `from the same sources you read from. Don't bother writing dates, miles, days_away ` +
    `into payloads; they're overwritten.`,
  );

  if (o.compact) {
    lines.push('');
    lines.push(`# MOBILE BREVITY`);
    lines.push(
      `- lead: ONE sentence, ≤12 words.\n` +
      `- voice: ≤2 lines, total ≤60 words. Drop in mid-thought; no "Good morning."\n` +
      `- Topics: ≤2 cards.`,
    );
  }

  return lines.join('\n');
}

// ── System prompt — surface/mode doctrine + voice character ─────────────

function systemPromptFor(surface: Surface, mode: string, _compact?: boolean): string {
  // Delegate to existing doctrine; downstream prompts/index.ts has the
  // voice + per-mode rules. We're not stuffing data here either.
  return promptFor(surface, mode);
}

// ── JSON parsing (final assistant text) ─────────────────────────────────

function parseLLMOutput(raw: string): { lead?: string; voice?: string[]; topics?: Topic[] } {
  let s = raw;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  else {
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first >= 0 && last > first) s = raw.slice(first, last + 1);
  }
  try { return JSON.parse(s); } catch { return {}; }
}
