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

export async function generateBriefing(
  userId: string,
  surface: Surface,
  raceSlug?: string,
  /** When true, generate a paraphrased mobile-friendly voice (shorter lead,
   *  fewer voice lines, no horizon prose unless A-race < 4 weeks). Plumbed
   *  from /api/briefing?client=ios. */
  compact?: boolean,
): Promise<BriefingResponse> {
  const state = await loadCoachState(userId);
  const resolved = resolveMode(surface, state, raceSlug);
  const eligible = eligibleKinds(state, resolved.candidateTopics);

  // Cache layer — read first. Voice only regenerates when state inputs change.
  const sig = signatureOf(state, raceSlug, compact);
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
  const userMessage = buildUserMessage(state, resolved, eligible, compact);

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

  // Server-side enrichment: inject deterministic IDs + NUMBERS the LLM
  // can't be trusted to repeat. The LLM authors voice; numeric values
  // come from state.
  const DOW_NAMES = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
  for (const t of validatedTopics) {
    const p = t.payload as any;
    if (t.kind === 'run_recap' && state.latest_activity?.id) {
      p.activity_id = state.latest_activity.id;
    }
    if (t.kind === 'sleep_deficit') {
      if (state.sleep7Avg != null) p.avg_h_7n = state.sleep7Avg;
      p.deficit_h_7n = state.sleep7Deficit ?? 0;
    }
    if (t.kind === 'next_workout' && state.nextWorkout) {
      const nw = state.nextWorkout;
      // Compute DOW from the date so it's correct (LLM was hallucinating).
      const d = new Date(nw.date + 'T12:00:00Z');
      const isTomorrow = nw.date === new Date(Date.parse(state.today + 'T12:00:00Z') + 86400000).toISOString().slice(0,10);
      p.dow = isTomorrow ? 'TOMORROW' : DOW_NAMES[d.getUTCDay()];
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
      // Tone from how close we are
      p.tone = r.days_to_race <= 7 ? 'race_week'
        : r.days_to_race <= 21 ? 'sharpening'
        : 'building';
    }
  }

  // Drop topics that would duplicate UI we already render elsewhere:
  //
  //   - profile_gap with empty field   → would render a broken card
  //   - run_recap on /today            → TodayPlannedCard already shows
  //     "DONE · TYPE · X MI" with a link into the run detail modal, and
  //     the coach voice paragraphs already narrate the run. The recap
  //     card on the right rail is pure duplication.
  const filtered = validatedTopics.filter((t) => {
    if (t.kind === 'profile_gap') {
      const f = ((t.payload as any)?.field ?? '').trim();
      return f.length > 0;
    }
    if (t.kind === 'run_recap' && resolved.surface === 'today') {
      // If there's a real run today, the left-rail TodayPlannedCard owns
      // the recap. Suppress the right-rail dup.
      const todayDate = state.today;
      const a = state.latest_activity;
      if (a && a.date === todayDate && a.mi >= 0.5) return false;
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

function buildUserMessage(
  state: CoachState,
  resolved: ReturnType<typeof resolveMode>,
  eligible: string[],
  compact?: boolean,
): string {
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

  // RECENT RUNS (last 7 days) — used to ANCHOR the coach to facts.
  // The LLM has a strong tendency to invent "yesterday's threshold workout"
  // or "your run two days ago" when it has no data. Listing every recent
  // run explicitly + a hard prompt rule blocks that hallucination.
  if (state.recentRuns && state.recentRuns.length > 0) {
    lines.push('');
    lines.push(`RECENT RUNS (last 7 days · ${state.recentRuns.length} total). DO NOT reference any run not in this list. If the runner didn't run on a given day, don't speculate that they did.`);
    for (const rr of state.recentRuns) {
      lines.push(`  ${rr.date} (${dayOfWeekName(rr.date)}): ${rr.mi.toFixed(1)}mi · ${rr.type ?? 'run'} · pace ${rr.pace ?? '—'} · HR ${rr.hr ?? '—'}${rr.name ? ' · "' + rr.name + '"' : ''}`);
    }
    lines.push('  ↳ TRUTH CONTRACT: Only mention runs above. Do not invent "yesterday\'s threshold" or "Saturday\'s long run" unless it appears in this list. If you want to discuss the upcoming workout, use NEXT WORKOUT below.');
  } else {
    lines.push('');
    lines.push('RECENT RUNS: NONE in the last 7 days. Do not say the runner "completed" or "ran" anything — they haven\'t logged a run.');
  }
  // Week-position context — block "today is the start of the week"
  // hallucinations when today is mid-week.
  const todayDowName = dayOfWeekName(state.today);
  const isMonday = todayDowName === 'Monday';
  lines.push(`WEEK: ${state.weekDone}mi done / ${state.weekPlanned ?? '?'}mi planned${state.phaseLabel ? ' · phase ' + state.phaseLabel : ''}`);
  lines.push(`WEEK POSITION: today is ${todayDowName}. The training week runs Monday→Sunday.${isMonday ? ' Today IS the start of the week.' : ' The week STARTED on Monday — today is NOT the start of the week. Do not say "start of the week" or "fresh week starts today" unless today is Monday.'}`);

  // TODAY'S PLANNED WORKOUT — must be loud and clear so the LLM doesn't
  // narrate today as a continuation of yesterday's easy day.
  if (state.todayWorkout) {
    const t = state.todayWorkout;
    const typeStr = t.type.toUpperCase();
    const isQuality = ['threshold','intervals','tempo','race'].includes(t.type);
    const isEasy = ['easy','long','shakeout','recovery'].includes(t.type);
    lines.push('');
    lines.push(`🎯 TODAY'S WORKOUT (THIS IS WHAT YOU MUST NARRATE):`);
    lines.push(`  ${t.date} · ${typeStr} · ${t.mi}mi${t.label ? ' · ' + t.label : ''}`);
    if (isQuality) {
      lines.push(`  ↳ TYPE: QUALITY SESSION. This is NOT an easy day. Do NOT say "easy", "Z1-Z2", "no urgency", "just log the miles", "base mile". The runner is doing threshold/interval/tempo work today. Talk about pace targets, effort, what the session is for.`);
    } else if (isEasy) {
      lines.push(`  ↳ TYPE: AEROBIC / EASY day. Z1-Z2 framing is appropriate.`);
    }
    if (t.type === 'rest') {
      lines.push(`  ↳ TYPE: REST day. No miles today.`);
    }
  } else {
    lines.push('');
    lines.push(`TODAY'S WORKOUT: nothing on the plan today (rest / off-plan day).`);
  }

  if (state.nextWorkout) {
    const n = state.nextWorkout;
    lines.push(`NEXT WORKOUT (FUTURE, not today): ${n.date} (${dayOfWeekName(n.date)}) ${n.type} ${n.mi}mi${n.label ? ' · ' + n.label : ''}`);
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

  if (compact) {
    // iOS / mobile — the runner is reading on a small screen and the
    // structured workout card + week strip already lead the page. Keep
    // the prose tight; don't repeat what those surfaces show.
    lines.push('');
    lines.push(`# MOBILE BREVITY RULES (compact=true)`);
    lines.push(`- The phone screen ALREADY shows: today's structured workout (warmup → reps → cooldown with paces), the week strip, and the readiness ring. Don't restate that scaffolding.`);
    lines.push(`- \`lead\`: ONE sentence max. 12 words max. The "what's the move today" hook, nothing else.`);
    lines.push(`- \`voice\`: AT MOST 2 lines, each 1–2 short sentences. Total voice = under 60 words. Treat it like a text from your coach, not an email.`);
    lines.push(`- Skip preamble ("Good morning!" / "Today is..."). Drop in mid-thought.`);
    lines.push(`- Skip the horizon prose ("21 weeks out") UNLESS the A-race is < 28 days away.`);
    lines.push(`- Topics: emit AT MOST 2 cards. Prioritise fueling > race_horizon > coach_needs. Drop anything else for this mobile pass.`);
  }
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
