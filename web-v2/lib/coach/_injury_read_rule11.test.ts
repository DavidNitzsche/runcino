/**
 * RULE 11 GATE · a failed open-injury read is not "no injury".
 *
 * `loadGlanceState` used to close its `runner_injuries` query with
 * `.catch(() => ({ rows: [] }))`. On a SAFETY signal that collapses two
 * opposite facts: "this runner has no open injury" and "we could not find
 * out". `activeInjury` is null either way, the surface proceeds as if clear,
 * and nothing anywhere records that the check did not run.
 *
 * Audit blocker B8, 2026-09-02.
 *
 * WHAT THIS GATE CANNOT FAIL ON (Rule 22)
 *
 * It is a source-text check on ONE query in ONE file, so it cannot see the
 * same collapse anywhere else, and it cannot see it at all if the catch is
 * refactored into a helper. It does NOT assert that any consumer behaves
 * correctly when the read fails — deliberately, because that behaviour is an
 * open product decision recorded in the code comment: Today must not fabricate
 * a flare (an injury owns the whole screen) and must not silently prescribe as
 * if clear. This gate only guarantees the two facts stay distinguishable and
 * that the failure is logged rather than swallowed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'glance-state.ts'), 'utf8');

/** Strip comments. Without this the gate matches its own explanatory prose:
 *  the fix's comment QUOTES the old `.catch(() => ({ rows: [] }))` it replaced,
 *  and the first run of this gate failed on that quote rather than on code.
 *  A source-text gate must read code, not commentary about code. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** The injury query and everything up to the end of its catch block. */
function injuryReadBlock(): string {
  const start = SRC.indexOf('FROM runner_injuries');
  expect(start, 'the open-injury query has moved or gone').toBeGreaterThan(0);
  const end = SRC.indexOf('const activeInjury', start);
  expect(end, 'could not find the end of the injury read').toBeGreaterThan(start);
  return stripComments(SRC.slice(start, end));
}

describe('Rule 11 · the open-injury read', () => {
  it('LIVENESS · the file and the query are both actually there', () => {
    expect(SRC.length).toBeGreaterThan(5000);
    expect(SRC).toContain('FROM runner_injuries');
  });

  it('does not swallow the failure into an empty result', () => {
    const block = injuryReadBlock();
    // The exact shape that was there: a catch with no parameter, returning
    // empty rows and telling nobody.
    expect(block, 'a failed injury read must not be silently turned into '
      + '"no open injury" — they are opposite facts on a safety signal')
      .not.toMatch(/\.catch\(\s*\(\s*\)\s*=>/);
  });

  it('logs the failure', () => {
    expect(injuryReadBlock()).toContain('logReadFailure');
    expect(SRC).toContain("from '@/lib/db/read'");
  });

  it('records the failure in a field a consumer can branch on', () => {
    expect(injuryReadBlock()).toContain('injuryReadFailed = true');
    // and it must actually leave the function, or nothing downstream can see it
    expect(SRC).toMatch(/\n\s*injuryReadFailed,/);
    expect(SRC).toContain('injuryReadFailed?: boolean');
  });

  it('the flag defaults to false, so a clean read is not reported as a failure', () => {
    expect(SRC).toContain('let injuryReadFailed = false;');
  });
});
