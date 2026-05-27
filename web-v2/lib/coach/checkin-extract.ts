/**
 * checkin-extract.ts — turn a runner's free-text post-run note into
 * structured signals the coach can read directly.
 *
 * P-OPTION-C 2026-05-27. The chip set was a constrained UI for what
 * should be a conversation. Now the runner types what mattered ("trail
 * run with my neighbor, felt great, calf tight on cooldown") and the
 * extractor pulls the signals coach needs to act on.
 *
 * Design:
 *   - Single slim Anthropic call, no tool-use loop.
 *   - JSON-only output matching ExtractedSignals shape.
 *   - ~400 token cap; cost ~$0.005-0.01 per call.
 *   - Only fires when free text is present. Chip-only check-ins use
 *     buildStaticExtraction() — no LLM, just a structural mapping.
 *   - Coach reads the extracted signals via getCheckIns tool +
 *     activeNiggle HARD FACT.
 */
import Anthropic from '@anthropic-ai/sdk';

export interface ExtractedNiggle {
  body_part: string;                                         // "left calf", "right hip", "lower back"
  severity: 'mild' | 'moderate' | 'flare' | null;
  description: string;                                       // short quote / paraphrase
  resolved?: boolean;                                        // true when the runner explicitly says it's better/cleared
}

export interface ExtractedSignals {
  mood: 'high' | 'good' | 'flat' | 'low' | null;
  energy: 'fresh' | 'normal' | 'low' | 'gassed' | null;
  niggle: ExtractedNiggle | null;
  /** Anything that changes how the run should be interpreted —
   *  heat, trail surface, social pace, race-pace test, fasted, etc.
   *  Free-form strings; the coach reads them as context, not enums. */
  context_factors: string[];
  /** Implicit chip equivalents derived from the text, when the text
   *  is clearly affirming or contradicting the chips. */
  execution_implicit:
    | 'nailed' | 'controlled' | 'grinded' | 'missed' | 'pushed'
    | 'chatty' | 'strong' | 'faded' | 'walled'
    | 'crushed_goal' | 'on_goal' | 'missed_goal'
    | null;
  body_implicit: 'fresh' | 'worked' | 'cooked' | null;
  /** One-liner the coach can quote as a summary of what the runner said. */
  notable: string | null;
}

const EMPTY: ExtractedSignals = {
  mood: null,
  energy: null,
  niggle: null,
  context_factors: [],
  execution_implicit: null,
  body_implicit: null,
  notable: null,
};

/**
 * Build a static extraction from chip values alone — no LLM call.
 * Used for chip-only check-ins. The richer signals (niggle, context
 * factors) stay empty; the implicit fields just mirror the chips.
 */
export function buildStaticExtraction(
  execution: string | null | undefined,
  body: string | null | undefined,
): ExtractedSignals {
  return {
    ...EMPTY,
    execution_implicit: (execution ?? null) as ExtractedSignals['execution_implicit'],
    body_implicit: (body ?? null) as ExtractedSignals['body_implicit'],
  };
}

const SYSTEM = `
You are extracting structured signals from a runner's free-text post-run
note so a coach can act on it intelligently. You are NOT the coach.

OUTPUT FORMAT — strict JSON, no markdown fences, no prose around it:
{
  "mood":               "high" | "good" | "flat" | "low" | null,
  "energy":             "fresh" | "normal" | "low" | "gassed" | null,
  "niggle":             { "body_part": string, "severity": "mild" | "moderate" | "flare" | null, "description": string, "resolved": boolean } | null,
  "context_factors":    string[],
  "execution_implicit": "nailed" | "controlled" | "grinded" | "missed" | "pushed" | "chatty" | "strong" | "faded" | "walled" | "crushed_goal" | "on_goal" | "missed_goal" | null,
  "body_implicit":      "fresh" | "worked" | "cooked" | null,
  "notable":            string | null
}

EXTRACTION RULES:

- mood / energy: only fill when the text gives a clear signal. Don't
  guess. "Felt great" → mood=high. "Tough one" → mood=low. Quiet text
  → null.

- niggle: ANY mention of a body issue, even mild. Identify body part
  ("left calf", "right hip", "low back"). Severity: mild (just tight),
  moderate (sore/aching), flare (sharp or limiting). resolved=true
  ONLY when the runner explicitly says it's better/cleared/gone.
  Otherwise resolved=false.

- context_factors: short tags for anything that changes how this run
  should be interpreted vs the prescription. Examples:
    "heat", "humidity", "wind", "rain", "cold",
    "hills", "trail", "treadmill", "track",
    "social", "solo", "neighbor", "with friend",
    "fueled", "fasted", "morning", "evening", "after work",
    "stressed", "illness brewing", "sleep deprived",
    "race pace test", "tempo finish", "negative split", "fartlek"
  Skip generic ("ran outside"); include anything that materially
  changes how a coach should read pace/HR/effort.

- execution_implicit: if the text clearly implies a chip ("crushed
  it" → nailed; "couldn't hold pace" → missed; "ran easy with my
  buddy" → chatty). Otherwise null.

- body_implicit: same rule for body chips. "Legs feel great" → fresh.
  "Wrecked" → cooked. Otherwise null.

- notable: the one sentence the coach should know if they only get
  one sentence. Short, specific, faithful to the text. null if the
  text was just a quick "felt good."

OUTPUT JSON ONLY.
`.trim();

export interface ExtractInput {
  text: string;
  workout_kind?: string | null;
  execution_chip?: string | null;
  body_chip?: string | null;
}

export async function extractCheckin(input: ExtractInput): Promise<ExtractedSignals> {
  const trimmed = (input.text ?? '').trim();
  if (!trimmed) {
    return buildStaticExtraction(input.execution_chip, input.body_chip);
  }

  const userMessage = [
    `WORKOUT TYPE (planned): ${input.workout_kind ?? 'unknown'}`,
    `EXECUTION CHIP (if tapped): ${input.execution_chip ?? 'none'}`,
    `BODY CHIP (if tapped): ${input.body_chip ?? 'none'}`,
    ``,
    `RUNNER'S FREE TEXT:`,
    `"${trimmed}"`,
    ``,
    `Extract signals now. Output JSON only.`,
  ].join('\n');

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 400,
      system: [{ type: 'text', text: SYSTEM }],
      messages: [{ role: 'user', content: userMessage }],
    });

    const raw = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    // Strip any accidental fence the model may have added.
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsed = JSON.parse(cleaned) as Partial<ExtractedSignals>;

    // Belt-and-suspenders: never let the parsed shape drift outside
    // our enum tolerances. Unknowns silently become null.
    return {
      mood: parsed.mood ?? null,
      energy: parsed.energy ?? null,
      niggle: parsed.niggle && typeof parsed.niggle.body_part === 'string'
        ? {
            body_part: parsed.niggle.body_part,
            severity: parsed.niggle.severity ?? null,
            description: parsed.niggle.description ?? trimmed,
            resolved: Boolean(parsed.niggle.resolved),
          }
        : null,
      context_factors: Array.isArray(parsed.context_factors)
        ? parsed.context_factors.filter((s): s is string => typeof s === 'string').slice(0, 8)
        : [],
      execution_implicit: parsed.execution_implicit ?? null,
      body_implicit: parsed.body_implicit ?? null,
      notable: parsed.notable ?? null,
    };
  } catch (e: any) {
    console.error('[checkin-extract] failed:', e?.message ?? e);
    // Fall back to static extraction so the row still has something
    // useful in extras.extracted.
    const fallback = buildStaticExtraction(input.execution_chip, input.body_chip);
    fallback.notable = trimmed.slice(0, 160);
    return fallback;
  }
}
