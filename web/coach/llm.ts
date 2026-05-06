/**
 * Coach · LLM brain.
 *
 * Single Anthropic call wrapped to deliver `CoachDecision<T>` outputs.
 * The system prompt is composed from voice.md + a scope-appropriate
 * research doc (coaching-research.md and/or amp-research.md), with
 * `cache_control: ephemeral` so the second-and-onward calls inside a
 * 5-minute window pay ~10 % of the input-token cost.
 *
 * Scopes:
 *   • 'running'  — voice + coaching-research. Race-morning brief, daily
 *                  prescription rationale, plan adjustments, retros.
 *   • 'strength' — voice + amp-research. Strength-day prescription, Amp-
 *                  specific advice.
 *   • 'full'     — voice + both. Comprehensive retrospectives that
 *                  span run + strength training across a cycle.
 *
 * Don't include amp-research in calls that don't touch strength —
 * burns tokens and confuses the model. Don't include coaching-research
 * in pure strength calls — same reason.
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Citation, CoachDecision } from './types';

export type CoachScope = 'running' | 'strength' | 'full';

// ── Doc loading ──────────────────────────────────────────────────────
// Read once at module init; the docs are static. process.cwd() during
// `next dev` is the web/ directory; the research docs live one level
// up at /docs/.
const REPO_ROOT = process.cwd().endsWith('/web') ? join(process.cwd(), '..') : process.cwd();

let _voice: string | null = null;
let _coachingResearch: string | null = null;
let _ampResearch: string | null = null;

function voice(): string {
  if (_voice == null) _voice = readFileSync(join(REPO_ROOT, 'web/coach/voice.md'), 'utf-8');
  return _voice;
}
function coachingResearch(): string {
  if (_coachingResearch == null) _coachingResearch = readFileSync(join(REPO_ROOT, 'docs/coaching-research.md'), 'utf-8');
  return _coachingResearch;
}
function ampResearch(): string {
  if (_ampResearch == null) _ampResearch = readFileSync(join(REPO_ROOT, 'docs/amp-research.md'), 'utf-8');
  return _ampResearch;
}

// ── System prompt assembly ───────────────────────────────────────────
// Each text block gets its own cache_control marker so the cache is
// reused across calls regardless of which scope is requested. Per
// Anthropic's caching: marking the LAST block in a list of cacheable
// blocks creates a cache up to that point; we mark each block so any
// stable prefix is cached independently.

const COACH_SYSTEM_INSTRUCTIONS = `\
You are the Runcino Coach.

You return STRUCTURED JSON only. No prose outside the JSON object. Every
response must match exactly this shape:

{
  "answer": <the answer to the user's request, type depends on the call>,
  "rationale": <one short sentence in your voice — see voice doc>,
  "citations": [{ "section": "§N.M", "snippet": "<short prose excerpt>" }, …]
}

The "rationale" field is what the user reads. Write it in the voice
defined in the voice doc. NEVER include section numbers in the rationale
— citations live in the separate "citations" array, surfaced only when
the user taps a "why?" affordance.

The "citations" array points back at the section(s) of the research
doc that justify your answer. Use the §N or §N.M heading numbers from
the research doc. Include at least one citation. Use 1-3 short
snippets — verbatim phrases from the research are best.

If the user's request is for plain text (a brief, a rationale, a
narrative), put the text directly in "answer" as a string. If the
request is structured (workout, fueling plan, calibration delta), the
caller will tell you the schema and you fill it in.
`;

interface BuildSystemArgs {
  scope: CoachScope;
}

function buildSystem(args: BuildSystemArgs): Anthropic.Messages.TextBlockParam[] {
  const blocks: Anthropic.Messages.TextBlockParam[] = [
    {
      type: 'text',
      text: COACH_SYSTEM_INSTRUCTIONS,
    },
    {
      type: 'text',
      text: `# COACH VOICE\n\n${voice()}`,
      cache_control: { type: 'ephemeral' },
    },
  ];
  if (args.scope === 'running' || args.scope === 'full') {
    blocks.push({
      type: 'text',
      text: `# RUNNING COACHING RESEARCH\n\n${coachingResearch()}`,
      cache_control: { type: 'ephemeral' },
    });
  }
  if (args.scope === 'strength' || args.scope === 'full') {
    blocks.push({
      type: 'text',
      text: `# STRENGTH (AMP) RESEARCH\n\n${ampResearch()}`,
      cache_control: { type: 'ephemeral' },
    });
  }
  return blocks;
}

// ── The LLM call ─────────────────────────────────────────────────────

export interface CallCoachLLMArgs<T> {
  scope: CoachScope;
  /** What the caller wants the Coach to produce. Goes in the user
   *  message verbatim. Be specific: include schema if asking for
   *  structured output. */
  userPrompt: string;
  /** Schema description for the `answer` field — the model writes its
   *  output to match. Default: 'a string in the Coach voice'. */
  answerSchema?: string;
  /** Maximum tokens for the response. Default 1024 — enough for a
   *  paragraph + citations. Bump for retrospectives. */
  maxTokens?: number;
  /** Override the model. Default: Sonnet 4.6 — fast, voice-faithful,
   *  cheap with prompt caching. */
  model?: string;
}

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set — Coach LLM brain unavailable.');
  _client = new Anthropic({ apiKey });
  return _client;
}

/** Whether the LLM brain is available right now. UI surfaces should
 *  fall back to a deterministic stub if this returns false. */
export function llmAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function callCoachLLM<T = string>(args: CallCoachLLMArgs<T>): Promise<CoachDecision<T>> {
  const c = client();
  const userMessage = [
    args.userPrompt,
    '',
    `Return JSON. The "answer" field is: ${args.answerSchema ?? 'a string in the Coach voice'}.`,
  ].join('\n');

  const response = await c.messages.create({
    model: args.model ?? 'claude-sonnet-4-6',
    max_tokens: args.maxTokens ?? 1024,
    system: buildSystem({ scope: args.scope }),
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  // Extract JSON — model sometimes wraps in code fences despite the
  // "JSON only" instruction. Be liberal in what we accept.
  const jsonText = extractJson(text);
  let parsed: { answer: T; rationale: string; citations: Array<{ section: string; snippet?: string }> };
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(`Coach LLM returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (!parsed.answer || typeof parsed.rationale !== 'string') {
    throw new Error(`Coach LLM response missing required fields: ${jsonText.slice(0, 200)}`);
  }

  // Resolve citations against the right doc. Strength scope → amp;
  // running / full → coaching-research (the model can specify 'amp:'
  // prefix on a section if it needs to disambiguate in 'full' scope).
  const citations: Citation[] = (parsed.citations ?? []).map(c => {
    const sec = c.section.trim();
    const isAmp = sec.toLowerCase().startsWith('amp:') || sec.toLowerCase().startsWith('a§');
    const cleanSec = sec.replace(/^amp:\s*/i, '').replace(/^a§/, '§');
    return {
      doc: isAmp || args.scope === 'strength' ? 'docs/amp-research.md' : 'docs/coaching-research.md',
      section: cleanSec,
      snippet: c.snippet,
    };
  });

  return {
    answer: parsed.answer,
    rationale: parsed.rationale,
    citations,
    brain: 'llm',
  };
}

function extractJson(text: string): string {
  // Strip ```json ... ``` fences if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  // Otherwise find the first { … last } pair.
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) return text.slice(first, last + 1);
  return text;
}
