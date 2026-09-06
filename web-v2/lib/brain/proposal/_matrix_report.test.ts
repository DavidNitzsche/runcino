/**
 * lib/brain/proposal/_matrix_report.test.ts · THE MATRIX, PRINTED.
 *
 * ── WHY A TEST AND NOT A SCRIPT ────────────────────────────────────────────
 *
 * Because a completeness claim that lives in a handover document rots the day
 * after it is written, and this repo has the receipts: CLAUDE.md's own "claim
 * areas still unwatched" checklist went stale because entries were closed in
 * code and never in the list, and `check-palette-sync.sh` named two files that
 * no longer existed in the header of the script whose job was catching exactly
 * that.
 *
 * So the 21 x 14 matrix is COMPUTED from the registries every run, and printed.
 * A report quoting it is quoting something that was true when the suite last
 * passed, and a number that drifts drifts visibly.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 * · ALMOST EVERYTHING. It has exactly two assertions — that the matrix has the
 *   shape it claims, and that its own printing produced output. It is a
 *   REPORTER, and its correctness is `_action_completeness.test.ts`'s: every
 *   cell it prints as present is a cell that gate proved present, and every
 *   cell it prints as a gap is one that gate proved absent. If that suite is
 *   deleted this one prints a confident, unverified table.
 * · WHETHER A PRESENT FACET IS ANY GOOD. Same as its source.
 * · A FACET NOBODY THOUGHT OF. Fourteen is a list somebody wrote down.
 */

import { describe, it, expect } from 'vitest';
import { ALL_ACTION_KINDS, type ActionKind } from './action';
import { ALL_FACETS, FACET_GAPS, facetGapFor, facetCoverage } from './facets';

describe('the completeness matrix, printed', () => {
  it('prints every cell, so the number in a report is a measured one', () => {
    const width = Math.max(...ALL_ACTION_KINDS.map((k) => k.length));
    const head = `${'KIND'.padEnd(width)}  ${ALL_FACETS.map((f) => f.slice(0, 3)).join(' ')}`;
    const lines: string[] = [head, '-'.repeat(head.length)];

    for (const kind of ALL_ACTION_KINDS as readonly ActionKind[]) {
      const cells = ALL_FACETS.map((f) => (facetGapFor(kind, f) === null ? ' Y ' : ' . '));
      lines.push(`${kind.padEnd(width)}  ${cells.join('')}`);
    }

    const c = facetCoverage(ALL_ACTION_KINDS);
    lines.push('');
    lines.push(`cells ${c.cells} · present ${c.present} · gaps ${c.gaps}`);
    lines.push('');
    lines.push('GAPS, by facet:');
    for (const f of ALL_FACETS) {
      const on = FACET_GAPS.filter((g) => g.facet === f).map((g) => g.kind);
      if (on.length > 0) lines.push(`  ${f.padEnd(18)} ${on.length}  ${on.join(', ')}`);
    }

    // eslint-disable-next-line no-console
    console.log(`\n${lines.join('\n')}\n`);

    expect(lines.length).toBe(ALL_ACTION_KINDS.length + 2 + 4
      + ALL_FACETS.filter((f) => FACET_GAPS.some((g) => g.facet === f)).length);
    expect(c.cells).toBe(ALL_ACTION_KINDS.length * ALL_FACETS.length);
  });
});
