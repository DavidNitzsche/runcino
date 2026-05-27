/**
 * generateCheckinReply — slim LLM call that produces a 1-2 sentence
 * coach reply to a just-submitted post-run check-in.
 *
 * P-CHECKIN-REPLY 2026-05-27. The old flow busted the full briefing
 * cache and triggered a 15-20s LLM regen the moment the runner tapped
 * Send to coach — felt like the page reset. New flow: submit goes
 * here, gets a short reply back inline, the morning brief stays
 * intact. The next natural regen (day rollover, run ingest) absorbs
 * the check-in into the brief normally.
 *
 * Design:
 *   - Single Anthropic call, no tool-use loop.
 *   - Tight system prompt: "1-2 sentences, acknowledge what they
 *     reported, don't re-summarize the run, no questions back."
 *   - ~80 word output cap.
 *   - Cost per call: ~$0.005-0.01 vs ~$0.02-0.05 for a full brief regen.
 *   - Latency: ~3-5s vs 15-20s.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ExtractedSignals } from './checkin-extract';

/** Build a contextual reply for a TEXT-BEARING check-in.
 *
 *  P-OPTION-C 2026-05-27: when the runner writes free text, we already
 *  paid the LLM cost to extract structured signals. This reply uses
 *  both the text + extracted signals to write something specific to
 *  what the runner said.
 *
 *  Voice rules (same as the main brief):
 *  - No em-dashes.
 *  - No bpm-in-parens after zone names.
 *  - "target" banned for easy/long/recovery pace.
 *  - If a niggle is present, address it explicitly with appropriate concern.
 *  - If a context_factor explains an apparent miss (heat, trail, social),
 *    name the context so the runner knows the coach gets it.
 *  - 1-3 sentences. No questions back.
 */
export interface ContextualReplyInput {
  runner: string;
  noteText: string;
  signals: ExtractedSignals;
  todayWorkout: { type: string | null; mi: number; label: string | null } | null;
  todayBriefLead?: string | null;
}

const CONTEXTUAL_SYSTEM = `
You are the runner's coach. They just submitted a post-run check-in
with free text. You read the text + a set of extracted structured
signals; write a 1-3 sentence acknowledgment that lands specifically
on what they said.

PRIORITY ORDER for what to address:
  1. NIGGLE (any body issue) — name the body part, match the severity,
     say you've got it on your radar. Do not prescribe ice/rest; the
     next brief handles prescription. You CAN say "we'll watch how it
     feels on tomorrow's easy."
  2. CONTEXT FACTORS that change how the run reads — heat, trail,
     social, fasted — name them so the runner knows you understood
     why the run was what it was. Don't lecture; just acknowledge.
  3. MOOD / ENERGY — if the text was openly positive or openly low,
     match the tone honestly. No cheese on a positive run; no
     catastrophizing on a low run.

VOICE:
- Short. Direct. Plain English. No em-dashes ever.
- Use their first name once if it fits naturally.
- Do NOT re-summarize the run; they just lived it.
- Do NOT ask a question back.
- Do NOT prescribe; reference the next brief if needed.
- No bpm-in-parens after zone names. The word "target" is banned for
  easy/long/recovery pace.

OUTPUT: just the reply text. No JSON, no markdown, no "Coach:" prefix.
Max ~80 words.
`.trim();

export async function generateContextualReply(
  input: ContextualReplyInput
): Promise<string> {
  const s = input.signals;
  const sections: string[] = [
    `RUNNER: ${input.runner}`,
    `TODAY'S WORKOUT: ${input.todayWorkout
      ? `${input.todayWorkout.type ?? '—'} ${input.todayWorkout.mi}mi${input.todayWorkout.label ? ` (${input.todayWorkout.label})` : ''}`
      : 'no planned workout'}`,
    input.todayBriefLead ? `MORNING BRIEF SAID: "${input.todayBriefLead}"` : '',
    ``,
    `RUNNER'S FREE TEXT:`,
    `"${input.noteText.trim()}"`,
    ``,
    `EXTRACTED SIGNALS:`,
    `  mood:    ${s.mood ?? 'unspecified'}`,
    `  energy:  ${s.energy ?? 'unspecified'}`,
    `  niggle:  ${s.niggle
      ? `${s.niggle.body_part} (${s.niggle.severity ?? 'unspecified'}) — "${s.niggle.description}"${s.niggle.resolved ? ' [resolved]' : ''}`
      : 'none'}`,
    `  context_factors: ${s.context_factors.length ? s.context_factors.join(', ') : 'none'}`,
    `  notable: ${s.notable ?? 'none'}`,
    ``,
    `Write the 1-3 sentence reply now.`,
  ];

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 320,
    system: [{ type: 'text', text: CONTEXTUAL_SYSTEM }],
    messages: [{ role: 'user', content: sections.filter(Boolean).join('\n') }],
  });

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join(' ')
    .trim();

  return text.replace(/^["']/, '').replace(/["']$/, '').trim();
}

export interface CheckinReplyInput {
  runner: string;                  // first name for tone ("David")
  today: string;                   // YYYY-MM-DD
  todayWorkout: {                  // null when no plan for today
    type: string | null;
    mi: number;
    label: string | null;
  } | null;
  checkIn: {
    kind: 'post_run' | 'pre_run' | 'rest_day' | string;
    workout_kind?: string | null;  // quality | easy | long | race | recovery
    execution?: string | null;     // chatty | controlled | grinded | etc.
    body?: string | null;          // fresh | worked | cooked
    niggle?: string | null;        // free text
  };
  /** The lead the runner is currently seeing on the morning brief.
   *  Keeps the reply from repeating ground the brief already covered. */
  todayBriefLead?: string | null;
}

const SYSTEM = `
You are the runner's coach. The runner just submitted a post-run check-in.
Write a 1-2 sentence acknowledgment they'll see appear right under the
chips they tapped.

VOICE:
- Short. Direct. Plain English. No em-dashes ever.
- Address what they actually reported. Match their tone — if they wrote a
  niggle, sound like you read it.
- Use their first name once if it fits naturally; don't force it.

CONTENT RULES:
- Do NOT re-summarize the run. They just lived it and the morning brief
  already covered it.
- Do NOT ask a question back. This is an acknowledgment, not a thread.
- Do NOT prescribe ("rest tomorrow", "ice that") — the next brief
  handles prescription. But you CAN note a niggle is worth watching.
- If they tapped GRINDED IT OUT or HAD TO PUSH, respect the effort. No
  "great job!" cheese.
- If they wrote a NIGGLE, address it specifically with appropriate
  concern. That's the most important thing in the check-in.
- If only chips (no niggle), a brief affirmation tied to the workout
  type is enough.

ZONE/BPM RULES (inherit from main doctrine):
- Don't dump bpm numbers in parens after zone names.
- Don't report a pace delta within ±20s of plan on easy/long days.
- The word "target" is banned for easy/long/recovery pace.

OUTPUT: just the reply text. No JSON, no markdown, no "Coach:" prefix,
no quotation marks around it. Max ~60 words.
`.trim();

function describeCheckIn(c: CheckinReplyInput['checkIn']): string {
  const parts: string[] = [];
  if (c.workout_kind) parts.push(`workout type they ran: ${c.workout_kind}`);
  if (c.execution) parts.push(`execution chip: ${c.execution}`);
  if (c.body) parts.push(`body chip: ${c.body}`);
  if (c.niggle && c.niggle.trim()) {
    parts.push(`niggle free-text: "${c.niggle.trim()}"`);
  } else {
    parts.push(`niggle: none`);
  }
  return parts.join(' · ');
}

function describeTodayWorkout(w: CheckinReplyInput['todayWorkout']): string {
  if (!w) return "no planned workout today";
  const bits: string[] = [];
  if (w.type) bits.push(w.type);
  if (w.mi) bits.push(`${w.mi} mi`);
  if (w.label) bits.push(`(${w.label})`);
  return bits.join(' ') || 'unspecified';
}

/**
 * Canned reply matrix for chip-only check-ins (no niggle).
 *
 * 2026-05-27 David's call: "if this is the reply, thats fine but then
 * we dont need to call in the API or LLM it can just be canned
 * responses but the real magic happens in the backend." Generic
 * acknowledgments don't earn an LLM call — they earn a deterministic
 * line that's on-voice and instant. LLM is reserved for the case
 * where context actually matters (niggle present).
 *
 * Returns null when no canned line fits the (kind, execution, body)
 * combo — caller falls back to the LLM in that case (rare).
 */
export function pickCannedReply(
  kind: string | null | undefined,
  execution: string | null | undefined,
  body: string | null | undefined,
): string | null {
  const k = (kind ?? '').toLowerCase();
  const e = (execution ?? '').toLowerCase();
  const b = (body ?? '').toLowerCase();

  // Recovery / shakeout — body alone drives the reply.
  if (k === 'recovery' || !e) {
    if (b === 'fresh')  return 'Recovery done, body fresh. Building back.';
    if (b === 'worked') return 'Recovery run, legs felt it. Normal.';
    if (b === 'cooked') return 'Even recovery felt hard. Tomorrow likely lighter.';
  }

  // Easy / shakeout execution chips.
  if (k === 'easy') {
    if (e === 'chatty' && b === 'fresh')  return 'Easy day done right. Aerobic miles in the bank.';
    if (e === 'chatty' && b === 'worked') return 'Chatty pace, legs feeling it. Normal for the week.';
    if (e === 'chatty' && b === 'cooked') return "Easy was easy but the legs are flagging. Worth watching.";
    if (e === 'controlled' && b === 'fresh')  return 'Controlled effort, body fresh. Solid execution.';
    if (e === 'controlled' && b === 'worked') return 'Held it in check. Legs absorbed the work.';
    if (e === 'controlled' && b === 'cooked') return "Held the lid on but body's spent. Worth watching.";
    if (e === 'pushed' && b === 'fresh')  return "Easy that wasn't easy. Body says fresh — fitness keeps showing up.";
    if (e === 'pushed' && b === 'worked') return 'Pushed to hold easy pace. Fatigue is real today.';
    if (e === 'pushed' && b === 'cooked') return "Pushed and paid. Tomorrow's prescription will reflect this.";
  }

  // Quality (threshold / tempo / intervals).
  if (k === 'quality') {
    if (e === 'nailed' && b === 'fresh')  return "Workout in the bag and body holding. That's the green light.";
    if (e === 'nailed' && b === 'worked') return 'Reps landed clean. Body felt it, normal after quality.';
    if (e === 'nailed' && b === 'cooked') return "Nailed the splits but the body's smoked. Recovery matters tomorrow.";
    if (e === 'grinded' && b === 'fresh')  return 'Grinded through it. Body bouncing back, strong sign.';
    if (e === 'grinded' && b === 'worked') return 'Hard work, body knows it. The session got done.';
    if (e === 'grinded' && b === 'cooked') return 'Grinded and emptied the tank. Honor that tomorrow.';
    if (e === 'missed' && b === 'fresh')  return "Reps slipped but body's intact. We'll regroup next session.";
    if (e === 'missed' && b === 'worked') return "Couldn't hold the splits. Body's worked, accumulated fatigue maybe.";
    if (e === 'missed' && b === 'cooked') return 'Workout fell apart and body wrecked. Backing off makes sense.';
  }

  // Long run.
  if (k === 'long') {
    if (e === 'strong' && b === 'fresh')  return "Long run strong end to end. That's the engine building.";
    if (e === 'strong' && b === 'worked') return 'Held strong, finished with miles in the legs. Good rep.';
    if (e === 'strong' && b === 'cooked') return 'Strong through but emptied the well. Tomorrow easy.';
    if (e === 'faded' && b === 'fresh')  return 'Faded late but body bouncing back. Endurance still building.';
    if (e === 'faded' && b === 'worked') return 'Late miles got hard. Body worked. Normal for a stretch run.';
    if (e === 'faded' && b === 'cooked') return 'Hit the limit late and emptied. Recovery is the priority.';
    if (e === 'walled' && b === 'fresh')  return "Hit the wall but body's resilient. Worth a fueling look.";
    if (e === 'walled' && b === 'worked') return "Walled. Body's spent. Refuel and rest.";
    if (e === 'walled' && b === 'cooked') return 'Walled and wrecked. Tomorrow is easy or off.';
  }

  // Race.
  if (k === 'race') {
    if (e === 'crushed_goal' && b === 'fresh')  return "Goal crushed and body says ready for more. That's a level shift.";
    if (e === 'crushed_goal' && b === 'worked') return 'Goal crushed, body honestly worked. Earned it.';
    if (e === 'crushed_goal' && b === 'cooked') return 'Crushed it and gave everything. Honor the recovery now.';
    if (e === 'on_goal' && b === 'fresh')  return 'On goal, body fresh. Race execution dialed.';
    if (e === 'on_goal' && b === 'worked') return "Hit the goal honestly. Body worked. That's a quality day.";
    if (e === 'on_goal' && b === 'cooked') return "On goal but emptied the tank. That's what race day takes.";
    if (e === 'missed_goal' && b === 'fresh')  return "Missed the time, body felt fine. Pacing or course noise — let's debrief.";
    if (e === 'missed_goal' && b === 'worked') return "Missed it, body worked hard. Didn't go the way you wanted.";
    if (e === 'missed_goal' && b === 'cooked') return 'Missed and cooked. Tough one. Recovery first, postmortem later.';
  }

  // No canned line fits — caller can decide whether to fall back to LLM.
  return null;
}

export async function generateCheckinReply(
  input: CheckinReplyInput
): Promise<string> {
  const userMessage = [
    `RUNNER: ${input.runner}`,
    `TODAY: ${input.today}`,
    `TODAY'S WORKOUT: ${describeTodayWorkout(input.todayWorkout)}`,
    input.todayBriefLead
      ? `THIS MORNING'S BRIEF SAID: "${input.todayBriefLead}"`
      : `THIS MORNING'S BRIEF: not available`,
    ``,
    `THE CHECK-IN they just submitted:`,
    `  ${describeCheckIn(input.checkIn)}`,
    ``,
    `Write the 1-2 sentence reply now.`,
  ].join('\n');

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 240,
    system: [{ type: 'text', text: SYSTEM }],
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join(' ')
    .trim();

  // Defensive: strip wrapping quotes the model sometimes adds.
  return text.replace(/^["']/, '').replace(/["']$/, '').trim();
}
