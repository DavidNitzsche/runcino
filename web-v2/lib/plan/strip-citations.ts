/**
 * lib/plan/strip-citations.ts · runner-facing citation scrub.
 *
 * 2026-08-17 · coach-experience pass. adapt.ts writes `why` strings that
 * carry Research/ citations ("Comeback protocol per Research/22 §14.").
 * Those strings flow verbatim into coach_intents.value.why and from
 * there straight onto runner-facing surfaces (adaptation-info.ts,
 * TrainView adaptations, workout proposals). The locked voice doctrine
 * (run-purpose.ts, 2026-05-31: "no citations on the payload · rooted in
 * research is for the engine, not the runner") already bans this — the
 * adapter whys just never got the scrub.
 *
 * The engine KEEPS its citations: doctrine comments, the citation field
 * on plan_proposals payloads, and the ResearchCitation enum are all
 * untouched. This helper strips them from the ONE string a runner reads.
 *
 * Rules:
 *   1. A sentence that IS a citation (starts with "Research/") drops
 *      whole — including doctrine-recital tails ("Research/22 §14: 1-7
 *      days, resume plan, ...").
 *   2. Parenthetical citations "(Research/01:316-320)" drop.
 *   3. Inline refs drop with their connective ("per Research/22 §14",
 *      "· Research/01:319-320", bare "Research/22:635").
 *   4. Punctuation and spacing tidied; empty leftovers drop.
 *
 * The plain-English half of every why survives untouched.
 */

/** Inline reference: Research/<file>[:line[-line]][ §section]. */
const REF = /Research\/[0-9A-Za-z_.\-]+(?::[0-9]+(?:-[0-9]+)?)?(?:\s+§[^\s.,;:()]+)?/;

/**
 * Strip Research/ citation fragments from a runner-facing string.
 * Deterministic, idempotent, and a no-op when no citation is present.
 */
export function stripResearchCitations(text: string): string {
  if (!text || !text.includes('Research/')) return text;

  // Split on sentence boundaries, keeping the terminator with each part.
  const parts = text.split(/(?<=[.!?])\s+/);
  const kept: string[] = [];
  for (const raw of parts) {
    let s = raw;
    if (/^Research\//.test(s.trim())) continue; // rule 1 · citation-led sentence drops whole

    // rule 2 · parenthetical citations
    s = s.replace(new RegExp(`\\s*\\([^()]*${REF.source}[^()]*\\)`, 'g'), '');
    // rule 3 · inline refs with optional connective
    s = s.replace(new RegExp(`\\s*(?:\\bper\\b|\\bsee\\b|·)?\\s*${REF.source}`, 'g'), '');

    // rule 4 · tidy
    s = s
      .replace(/\(\s*\)/g, '')
      .replace(/\s+([.,;:!?])/g, '$1')
      .replace(/(?:\s*(?:\bper\b|·))+\s*([.!?])$/, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!s || /^[.,;:·!?\s]*$/.test(s)) continue;
    kept.push(s);
  }
  const out = kept.join(' ').trim();
  // Never return empty for a non-empty input — fall back to a blunt scrub.
  return out || text.replace(new RegExp(REF.source, 'g'), '').replace(/\s{2,}/g, ' ').trim();
}
