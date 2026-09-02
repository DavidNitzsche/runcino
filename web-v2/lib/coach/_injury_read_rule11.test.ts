/**
 * RULE 11 GATE · a failed open-injury read is not "no injury".
 *
 * ── WHAT THIS FILE USED TO BE, AND WHY IT CHANGED (2026-09-02) ─────────────
 *
 * `loadGlanceState` used to close its `runner_injuries` query with
 * `.catch(() => ({ rows: [] }))`. On a SAFETY signal that collapses two
 * opposite facts: "this runner has no open injury" and "we could not find
 * out". Audit blocker B8 named it; the first fix made the two
 * distinguishable via `injuryReadFailed`, and this gate pinned that fix by
 * reading the source text of the query and its catch block.
 *
 * That gate's own Rule 22 note recorded the half it deliberately did not
 * cover: "It does NOT assert that any consumer behaves correctly when the
 * read fails — deliberately, because that behaviour is an open product
 * decision recorded in the code comment."
 *
 * The decision was taken on 2026-09-02. There is now ONE canonical safety
 * owner (`lib/safety/**`) emitting NORMAL / CAUTION / MODIFY / STOP / UNKNOWN,
 * the query itself has MOVED there, and `loadGlanceState` is a consumer. So
 * this file no longer guards a query that lives here. It guards the
 * DELEGATION, which is the thing that could now silently regress:
 * a future edit re-adding a local read would restore the second author and
 * every source-text assertion about the old catch would pass vacuously,
 * because the text it looked for would simply be absent.
 *
 * The behavioural half — what the resolver ANSWERS on a failed read, and what
 * the surfaces do with it — is `lib/safety/_safety_verdict.test.ts`.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 *   · It is a source-text check on ONE file. It cannot see a second author
 *     anywhere else; `lib/safety/_safety_ownership.test.ts` is the scan that
 *     can, across `lib` and `app`.
 *   · It cannot tell whether the delegated verdict is CORRECT, only that the
 *     delegation happens.
 *   · It cannot see Swift.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'glance-state.ts'), 'utf8');
const OWNER = join(__dirname, '..', 'safety');

/** Strip comments. A source-text gate must read code, not commentary about
 *  code: the header above quotes the very shapes it forbids. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

describe('Rule 11 · the open-injury read is delegated, not re-authored', () => {
  const code = stripComments(SRC);

  it('LIVENESS · the file is really there and really has code in it', () => {
    expect(SRC.length).toBeGreaterThan(5000);
    expect(code).toContain('export async function loadGlanceState');
  });

  it('glance-state reads NO health table of its own', () => {
    // The three that carry a safety signal. Any of them appearing here means
    // a second author has grown back inside the consumer.
    expect(code, 'loadGlanceState must consume lib/safety, not re-read the tables')
      .not.toMatch(/FROM\s+(runner_injuries|sick_episodes|niggles)\b/i);
  });

  it('it calls the canonical owner', () => {
    expect(code).toContain('loadSafetyInputs');
    expect(code).toContain('classifySafety');
    expect(SRC).toContain("from '@/lib/safety/load-safety'");
    expect(SRC).toContain("from '@/lib/safety/safety-verdict'");
  });

  it('the owner it calls actually exists', () => {
    // Otherwise the two assertions above are satisfied by a dangling import
    // and this gate reports clean while nothing resolves.
    expect(readFileSync(join(OWNER, 'load-safety.ts'), 'utf8')).toContain('export async function loadSafetyInputs');
    expect(readFileSync(join(OWNER, 'safety-verdict.ts'), 'utf8')).toContain('export function classifySafety');
  });

  it('the verdict leaves the function, so a consumer can branch on it', () => {
    expect(SRC).toMatch(/\n\s*safety,/);
    expect(SRC).toContain('safety?: SafetyResolution;');
  });

  it('`injuryReadFailed` is DERIVED from the verdict, never decided locally', () => {
    // It survives for the call sites that predate the owner. What must not
    // survive is a second place deciding what a failed read means.
    expect(SRC).toContain('injuryReadFailed?: boolean');
    expect(SRC).toMatch(/\n\s*injuryReadFailed,/);
    expect(code, 'the flag must be computed from safety.unreadable, not set by a catch')
      .toMatch(/injuryReadFailed\s*=\s*\n?\s*!safety\.known/);
    expect(code).not.toContain('injuryReadFailed = true');
  });
});
