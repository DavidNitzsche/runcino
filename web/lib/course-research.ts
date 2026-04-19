/**
 * Course research — turn a race name into a draft CourseFacts file.
 *
 * Uses the Anthropic API with the `web_search` tool enabled. The model
 * is constrained by a system prompt to:
 *   - Never invent a fact
 *   - Cite the source URL for every claim
 *   - Include a verified quote where possible
 *   - Classify source confidence
 *   - Default to the lowest plausible confidence tier
 *
 * Output is written as `data/courses/<slug>.draft.json` — the human
 * reviews each claim and promotes the file to `<slug>.json` only
 * after checking against the official race bible.
 *
 * Nothing from research auto-ships to the Watch.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { CourseFacts } from './course-facts';

export interface ResearchInput {
  raceName: string;
  officialUrl?: string;
  /** Hint about typical race date format, e.g. "last Sunday of April". */
  typicalDate?: string;
  expectedDistanceMi?: number;
}

export interface ResearchOutput {
  slug: string;
  facts: CourseFacts;
  reasoning: string;
  unresolvedQuestions: string[];
  rawSearchTraces: unknown[];
}

const RESEARCH_SYSTEM_PROMPT = `
You are a research assistant for Runcino, a personal race pacing tool. Your job is to build a CourseFacts JSON for a given race using the web_search tool.

## Hard rules — violating any is a failure

1. **Never invent a fact.** If you cannot find a claim in a source you can cite, omit it. Omission is always preferred to fabrication.
2. **Every claim must include a source URL.** No exceptions.
3. **Include a verified_quote field** (short quote from the page) whenever you can — this is how humans will check your work.
4. **Classify confidence conservatively:**
   - "primary_source_verified" → ONLY when the URL is on the official race domain (e.g. bigsurmarathon.org, ncmrunning.com)
   - "secondary_source" → Wikipedia, reputable running publications (runnersworld.com, letsrun.com), race review blogs
   - "unverified_rumor" → rumored / widely repeated but you cannot find a source for it
5. **When in doubt, downgrade.** If you are not CERTAIN a URL belongs to the official race site, mark it secondary_source.
6. **Distances and grades are particularly risky.** If two sources disagree, note it in the unresolvedQuestions and pick the primary source.
7. **Do not carry over facts from race year to race year blindly.** Courses sometimes change. Note if you see course modifications.
8. **You will be reviewed by a human.** They will check your work against the official race course bible. Make their job easier by being thorough with citations and quotes.

## Output structure

Return a JSON object matching this TypeScript interface exactly:

\`\`\`
{
  slug: string,              // kebab-case, e.g. "big-sur-marathon"
  facts: CourseFacts,        // see CourseFacts schema below
  reasoning: string,         // your approach and any conflicts encountered
  unresolvedQuestions: string[]  // anything you couldn't nail down — flag these for the human reviewer
}
\`\`\`

## CourseFacts schema

\`\`\`
{
  race: {
    name: string,
    slug: string,
    description: string,
    course_type: "point_to_point" | "loop" | "out_and_back",
    typical_date: string,
    expected_facts: {
      distance_mi: number,
      distance_m: number,
      total_gain_ft: number,
      total_loss_ft: number,
      net_ft: number
    },
    expected_tolerances: {
      distance_mi: number,   // default 0.2
      gain_ft: number,       // default 400
      loss_ft: number        // default 400
    },
    sources: SourceCitation[]
  },
  phases: PhaseFact[],       // 4-8 logical sections of the course
  landmarks: LandmarkFact[], // notable points — climbs, aid stations, iconic features
  notes_from_sources: { [key: string]: { status, ... } },  // edge cases you want the reviewer to see
  warnings: { [key: string]: string }  // race-specific warnings
}

SourceCitation: {
  url: string,
  title?: string,
  confidence: "primary_source_verified" | "secondary_source" | "unverified_rumor",
  verified_at: string,         // ISO date YYYY-MM-DD
  verified_quote?: string      // exact quote from the page
}

PhaseFact: {
  index: number,
  label: string,
  start_mi: number,
  end_mi: number,
  expected_mean_grade_pct?: number,
  expected_gain_ft?: number,
  note: string,                // one sentence, actionable for a runner
  sources: SourceCitation[]    // at least one
}

LandmarkFact: {
  at_mi: number,
  kind: "landmark" | "summit" | "climb_warning" | "aid_station",
  label: string,
  note: string,                // one sentence
  sources: SourceCitation[]
}
\`\`\`

## Approach

1. **If the user provided an officialUrl, START THERE.** That's their best guess at the primary source. Fetch it, read the course info / course map page, and extract distance, total gain/loss, phase breakdown from the official text FIRST. Do not begin a general search until you've exhausted the official site.

2. If no officialUrl was provided, search for the race's official website. Verify the URL is on what appears to be the official race domain (match against common patterns: the race name in the domain, a registration/entry page, a "Home" or "About" page that describes the event itself). When in doubt, flag it in unresolvedQuestions for the human to confirm.

3. After the official site is exhausted, supplement with mile-by-mile descriptions from reputable running sources (runnersworld.com, letsrun.com, race review blogs, Wikipedia). These are secondary_source confidence.

4. Cross-reference any distance or grade claim across sources. If two reputable sources disagree, pick the one that agrees with the official site (or the one with a verified_quote if only one has one) and note the disagreement in unresolvedQuestions.

5. Return the JSON. Be exhaustive about citations.
`;

/**
 * Run course research. Requires ANTHROPIC_API_KEY.
 *
 * This is a real network call. Intended to be invoked from a CLI during
 * research time, not during race-day pipeline execution.
 */
export async function researchCourse(input: ResearchInput): Promise<ResearchOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set. Research requires Claude API access.');
  }

  const client = new Anthropic({ apiKey });

  const userMessage = `
Research the "${input.raceName}" course.

${input.officialUrl ? `User-suggested official URL: ${input.officialUrl}` : 'No official URL provided — find it via web search.'}
${input.typicalDate ? `Typical race date: ${input.typicalDate}` : ''}
${input.expectedDistanceMi ? `Expected distance: ${input.expectedDistanceMi} mi (verify)` : ''}

Return the JSON only. Do not add commentary outside the JSON structure.
Today's date: ${new Date().toISOString().slice(0, 10)}.
`;

  // Note: web_search tool interface may vary by SDK version. The user's
  // AGENTS.md warns about SDK drift — this implementation targets the
  // server-tool web_search beta that ships with Claude SDK 0.90+.
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: [
      { type: 'text', text: RESEARCH_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userMessage }],
    // Tool enablement — if the SDK/model surface doesn't support this exact
    // shape, the caller will get a clear error and we iterate.
    tools: [
      {
        type: 'web_search_20250305' as const,
        name: 'web_search',
        max_uses: 10,
      } as unknown as Anthropic.Messages.Tool,
    ],
  });

  // Collect text from final assistant content
  let raw = '';
  const traces: unknown[] = [];
  for (const block of response.content) {
    if (block.type === 'text') raw += block.text;
    else traces.push(block);
  }

  // Extract JSON (permissive — strip code fences if present)
  const jsonText = raw.replace(/```json\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed: {
    slug: string;
    facts: CourseFacts;
    reasoning: string;
    unresolvedQuestions: string[];
  };
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(
      `Claude returned invalid JSON. First 400 chars:\n${jsonText.slice(0, 400)}\n\nParse error: ${e}`
    );
  }

  return {
    slug: parsed.slug,
    facts: parsed.facts,
    reasoning: parsed.reasoning,
    unresolvedQuestions: parsed.unresolvedQuestions,
    rawSearchTraces: traces,
  };
}

/** Simple heuristic to audit a drafted facts file before we trust it. */
export function auditDraft(
  facts: CourseFacts
): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Every phase and landmark must have at least one source
  for (const p of facts.phases) {
    if (!p.sources || p.sources.length === 0) {
      errors.push(`Phase "${p.label}" has no citations.`);
    }
  }
  for (const l of facts.landmarks) {
    if (!l.sources || l.sources.length === 0) {
      errors.push(`Landmark "${l.label}" has no citations.`);
    }
  }

  // Count primary-source-verified landmarks
  const safeLandmarks = facts.landmarks.filter(l =>
    l.sources.some(s => s.confidence === 'primary_source_verified')
  );
  if (safeLandmarks.length < facts.landmarks.length) {
    warnings.push(
      `${facts.landmarks.length - safeLandmarks.length} of ${facts.landmarks.length} landmarks lack primary-source verification. Human review required before shipping to Watch.`
    );
  }

  // Distance plausibility
  if (facts.race.expected_facts.distance_mi < 1 || facts.race.expected_facts.distance_mi > 150) {
    errors.push(
      `Race distance ${facts.race.expected_facts.distance_mi} mi is implausible. Probably a parsing error.`
    );
  }

  return { warnings, errors };
}
