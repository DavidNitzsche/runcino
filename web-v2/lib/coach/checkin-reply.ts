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
