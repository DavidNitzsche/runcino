/**
 * lib/brain/proposal/_duration_offer_ruling_citation.test.ts · the product
 * ruling `DURATION_PROGRESS_OFFER` rests on RESOLVES against the real tree.
 *
 * DURATIONOFFER-1's authorization was first recorded only as prose inside
 * two code comments, citing a documentation path
 * (`docs/08-adaptation-vertical-slice/02-duration-lever-semantic-mapping.md`)
 * that did not exist anywhere in this repository — found by independent
 * review. Per this project's own Rule 20 ("a header comment asserting an
 * invariant is documentation, not enforcement — gate the claim or delete the
 * sentence"), the ruling now lives in `docs/PRODUCT_DECISIONS.md`, this
 * project's own canonical product-decision log, and this is the gate: it
 * reads the real file at run time and fails if the anchor a code comment
 * cites has drifted or been deleted, rather than trusting the comment's word
 * that it still resolves.
 *
 * Modelled on the `DOCTRINE_REGISTRY` pattern (`web-v2/lib/doctrine/
 * registry.ts`) — anchor on quoted text, never a line number, and read it
 * out of the real file rather than asserting both sides against each other.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// docs/PRODUCT_DECISIONS.md lives at the repo root, a sibling of web-v2/.
const DOC_PATH = path.resolve(__dirname, '../../../..', 'docs/PRODUCT_DECISIONS.md');
const ANCHOR = '## 2026-09-12 · DURATIONOFFER-1';

describe('DURATIONOFFER-1 · the product ruling cited by action.ts and action-proposal-lane.ts resolves', () => {
  it('docs/PRODUCT_DECISIONS.md exists and is not empty', () => {
    expect(fs.existsSync(DOC_PATH), `${DOC_PATH} does not exist`).toBe(true);
    const stat = fs.statSync(DOC_PATH);
    expect(stat.size, 'docs/PRODUCT_DECISIONS.md is empty').toBeGreaterThan(0);
  });

  it('the exact anchor heading this kind\'s doc comments cite is present, verbatim', () => {
    const text = fs.readFileSync(DOC_PATH, 'utf8');
    expect(
      text.includes(ANCHOR),
      `docs/PRODUCT_DECISIONS.md no longer contains the heading "${ANCHOR}" — the citation in `
      + 'lib/brain/proposal/action.ts and lib/plan/action-proposal-lane.ts has drifted. Either '
      + 'restore the heading or update both comments and this anchor together.',
    ).toBe(true);
  });

  it('the recorded ruling actually states the narrow scope, not just the heading', () => {
    const text = fs.readFileSync(DOC_PATH, 'utf8');
    const start = text.indexOf(ANCHOR);
    expect(start).toBeGreaterThan(-1);
    const nextSection = text.indexOf('\n## ', start + ANCHOR.length);
    const section = text.slice(start, nextSection === -1 ? undefined : nextSection);
    // The load-bearing constraints a future reader must still find here.
    for (const phrase of [
      'No automatic application',
      'No plan, workout, target, session-geometry, or runner-state mutation',
      'No widening this authorization to DURATION, DENSITY',
      'DENSITY remains explicitly undefined and off',
      'RECORD_ONLY',
    ]) {
      expect(section.includes(phrase), `the DURATIONOFFER-1 section no longer states: "${phrase}"`).toBe(true);
    }
  });
});
