/**
 * Gel-spec lookup.
 *
 * The user types something like "Maurten Gel 100" or "GU Roctane" and
 * we need to turn that into a number of carbs per serving so the
 * fueling planner can compute the right number of gels and the right
 * carb rate.
 *
 * Two layers, in order:
 *
 *   1. KNOWN_GELS — hand-curated lookup table for the popular brands.
 *      Fast, deterministic, no API call. Add to this any time the
 *      Claude lookup returns a confident answer.
 *
 *   2. Claude lookup — when the brand isn't in KNOWN_GELS and an API
 *      key is available, ask Claude to identify the gel's spec from
 *      its public product info. Returns null if Claude isn't
 *      confident or there's no API key.
 *
 * The caller decides what to do on a miss — typically falls back to
 * a 40 g default (the most common serving size) so the plan still
 * builds.
 */

import Anthropic from '@anthropic-ai/sdk';

export interface GelSpec {
  /** Canonical brand+product label, eg "Maurten Gel 100" */
  brand: string;
  /** Grams of carbs per serving */
  carbsG: number;
  /** Where the answer came from: a cached entry or a Claude lookup */
  source: 'known' | 'claude' | 'default';
}

/** Hand-curated lookup for the most common race gels.
 *  Match keys are lowercase substrings — first hit wins. */
const KNOWN_GELS: Array<{ patterns: string[]; spec: { brand: string; carbsG: number } }> = [
  { patterns: ['maurten gel 100', 'maurten 100'],     spec: { brand: 'Maurten Gel 100',     carbsG: 25 } },
  { patterns: ['maurten gel 160', 'maurten 160'],     spec: { brand: 'Maurten Gel 160',     carbsG: 40 } },
  { patterns: ['maurten gel 100 caf', 'maurten caf'], spec: { brand: 'Maurten Gel 100 Caf', carbsG: 25 } },
  { patterns: ['gu roctane'],                          spec: { brand: 'GU Roctane Energy Gel', carbsG: 25 } },
  { patterns: ['gu liquid'],                           spec: { brand: 'GU Liquid Energy Gel',  carbsG: 32 } },
  { patterns: ['gu original', 'gu energy gel', 'gu energy'], spec: { brand: 'GU Original Energy Gel', carbsG: 22 } },
  { patterns: ['sis beta fuel', 'sis beta'],          spec: { brand: 'SiS Beta Fuel Gel',   carbsG: 40 } },
  { patterns: ['sis go isotonic', 'sis go'],          spec: { brand: 'SiS GO Isotonic Gel', carbsG: 22 } },
  { patterns: ['precision fuel 30',  'pf 30'],        spec: { brand: 'Precision Fuel 30',   carbsG: 30 } },
  { patterns: ['precision fuel 90',  'pf 90'],        spec: { brand: 'Precision Fuel 90',   carbsG: 90 } },
  { patterns: ['huma'],                                spec: { brand: 'Huma Chia Energy Gel', carbsG: 21 } },
  { patterns: ['hammer'],                              spec: { brand: 'Hammer Gel',           carbsG: 22 } },
  { patterns: ['spring energy', 'spring'],             spec: { brand: 'Spring Energy',        carbsG: 22 } },
  { patterns: ['skratch sport gel', 'skratch'],        spec: { brand: 'Skratch Sport Energy Gel', carbsG: 22 } },
  { patterns: ['neversecond c30', 'neversecond'],      spec: { brand: 'Neversecond C30',      carbsG: 30 } },
  { patterns: ['neversecond c90'],                     spec: { brand: 'Neversecond C90',      carbsG: 90 } },
  { patterns: ['clif shot bloks', 'shot bloks'],       spec: { brand: 'Clif Shot Bloks (3-pc)', carbsG: 24 } },
  { patterns: ['clif shot gel', 'clif gel', 'clif'],   spec: { brand: 'Clif Shot Energy Gel', carbsG: 22 } },
  { patterns: ['honey stinger'],                       spec: { brand: 'Honey Stinger Gel',    carbsG: 28 } },
];

/** Try the local cache first — returns null on miss. */
export function lookupGelKnown(brandRaw: string): GelSpec | null {
  const q = brandRaw.trim().toLowerCase();
  if (!q) return null;
  for (const entry of KNOWN_GELS) {
    for (const pat of entry.patterns) {
      if (q.includes(pat)) {
        return { ...entry.spec, source: 'known' };
      }
    }
  }
  return null;
}

/** Ask Claude what's in this gel. Falls back to null on any error
 *  or low-confidence response so the caller can apply a default. */
export async function lookupGelWithClaude(brandRaw: string, apiKey: string): Promise<GelSpec | null> {
  const q = brandRaw.trim();
  if (!q) return null;
  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
      system: 'You identify endurance-sport energy gels and return their spec. Be precise. If the product is ambiguous or you cannot identify it confidently, set confident=false.',
      tools: [
        {
          name: 'set_gel_spec',
          description: 'Record the carb content of an identified energy gel.',
          input_schema: {
            type: 'object',
            properties: {
              canonical_brand: { type: 'string', description: 'The product\'s full canonical name, e.g. "Maurten Gel 100"' },
              carbs_g_per_serving: { type: 'number', description: 'Grams of carbohydrate per single gel/sachet' },
              confident: { type: 'boolean', description: 'true only if you are sure about both fields' },
            },
            required: ['canonical_brand', 'carbs_g_per_serving', 'confident'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'set_gel_spec' },
      messages: [
        {
          role: 'user',
          content: `Identify this race-fueling product and report its carbs per serving: "${q}". If it could be one of several products (e.g. just "Maurten"), pick the most common road-race choice — for Maurten that's Gel 100.`,
        },
      ],
    });
    const block = resp.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') return null;
    const input = block.input as { canonical_brand: string; carbs_g_per_serving: number; confident: boolean };
    if (!input.confident) return null;
    const carbs = Math.round(input.carbs_g_per_serving);
    if (!Number.isFinite(carbs) || carbs < 5 || carbs > 120) return null;
    return { brand: input.canonical_brand, carbsG: carbs, source: 'claude' };
  } catch (e) {
    console.warn('[gel-lookup] Claude failed:', e);
    return null;
  }
}

/** Resolve a gel spec using known cache first, then Claude if an API
 *  key is available. Always returns SOMETHING — falls back to a
 *  generic 40 g default so the planner can still build. */
export async function resolveGelSpec(brandRaw: string, apiKey: string | undefined): Promise<GelSpec> {
  const known = lookupGelKnown(brandRaw);
  if (known) return known;
  if (apiKey) {
    const claude = await lookupGelWithClaude(brandRaw, apiKey);
    if (claude) return claude;
  }
  // Default: the most common serving size across mainstream gels.
  return { brand: brandRaw.trim() || 'Gel', carbsG: 40, source: 'default' };
}
