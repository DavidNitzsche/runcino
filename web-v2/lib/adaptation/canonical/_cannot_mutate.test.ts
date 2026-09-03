/**
 * lib/adaptation/canonical/_cannot_mutate.test.ts · THE ENGINE CANNOT WRITE,
 * EVEN IF IT IS CALLED.
 *
 * The brief's requirement is structural, not behavioural: "The engine must be
 * structurally incapable of mutating a plan." So this file proves four things
 * from source, none of which depend on the engine behaving well:
 *
 *   1 · No file here issues a write against any table.
 *   2 · No file here imports a database, a pool, a client, an ORM, `fetch`, or
 *       anything else that could reach the outside world. A pure function
 *       cannot mutate a plan whatever it is handed.
 *   3 · No file here names a known plan writer.
 *   4 · Nothing outside this directory imports it, INCLUDING through a nested
 *       path. This closes a real hole described below.
 *
 * ── THE HOLE THIS FILE CLOSES IN THE PRE-EXISTING GATE ─────────────────────
 *
 * `_zero_mutation_scan.test.ts` guard 3 rations who may import this layer with
 *
 *     /import\s+(type\s+)?\{([^}]*)\}\s+from\s+'(@\/lib\/adaptation\/[a-z-]+)'/g
 *
 * `[a-z-]+` matches ONE path segment, so `@/lib/adaptation/canonical/evaluate`
 * is invisible to it: the ratchet that is supposed to stop a plan writer
 * importing the proposal path cannot see anything in a subdirectory. That gate
 * predates this subdirectory and is not wrong, it is scoped to the flat layout
 * it was written for. Guard 4 below covers nested paths, and the gap is
 * reported rather than silently patched, because the same blind spot applies to
 * any future subdirectory anyone adds under `lib/adaptation`.
 *
 * ── RULE 18 · LIVENESS AND FALSIFICATION ───────────────────────────────────
 *
 * Each guard has an ORACLE proving its detector fires on planted violations,
 * and each states how many files it read. Falsified by hand before landing.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 * · A write reached through a function imported from outside whose name is not
 *   in the writer list. Guard 2 is the real defence there: with no I/O import
 *   of any kind, there is no transport for a write to travel on.
 * · A caller that takes a returned `PlanDiff` and applies it itself. Nothing
 *   here can stop that, and nothing should: the diff is the deliverable. What
 *   guard 4 does is ensure no such caller currently exists, so wiring one
 *   becomes a deliberate, reviewable act rather than an accident.
 * · Behaviour. This file reads source, never runs the engine. The purity test
 *   at the bottom is the only behavioural check and it is deliberately narrow.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { evaluateAdaptation } from './evaluate';
import { baseInput, threeGoodWeeks, twoGoodLongRuns } from './_fixtures';

const HERE = __dirname;
const WEB = path.resolve(HERE, '..', '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('._') || name === 'node_modules' || name === '.next') continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

export function stripComments(src: string): string {
  const BLOCK = new RegExp('/\\*[\\s\\S]*?\\*/', 'g');
  const LINE = new RegExp('(^|[^:\'"\\x60])//[^\\n]*', 'g');
  return src
    .replace(BLOCK, (m) => m.replace(/[^\n]/g, ' '))
    .replace(LINE, (_m, p1: string) => p1);
}

const WRITE_RE =
  /\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi;

export function writesIn(src: string): Array<{ verb: string; table: string }> {
  const out: Array<{ verb: string; table: string }> = [];
  for (const m of stripComments(src).matchAll(WRITE_RE)) {
    out.push({ verb: m[1].toUpperCase().replace(/\s+/g, ' '), table: m[2] });
  }
  return out;
}

/** Anything that could reach the world outside this process. */
const IO_IMPORT_RE =
  /from\s+'(@\/lib\/db\/[^']*|pg|pg-pool|node:fs|node:net|node:dns|fs|net|dns|@vercel\/postgres|drizzle[^']*|knex|@prisma\/client)'/;

const PLAN_WRITERS = [
  'applyAdaptations', 'tryAdaptiveBump', 'actionForAdaptiveRamp', 'planUpgrade',
  'applyProgressionReshape', 'mutatePlan', 'reanchorActivePlan', 'recomputePacesForPlan',
  'refreshRaceRowsForPlan', 'generatePlan', 'persistComposedPlan', 'fireAutoRebuild',
  'writeWorkoutProposals', 'reanchorLthr', 'rebuildActivePlanForPrefs',
] as const;

export function writerNamesIn(src: string): string[] {
  const code = stripComments(src);
  return PLAN_WRITERS.filter((w) => new RegExp(`\\b${w}\\b`).test(code));
}

/**
 * Engine source only.
 *
 * `.test.ts` and `.script.ts` are excluded, matching the predicate the
 * pre-existing `_zero_mutation_scan.test.ts` already uses. Both kinds of file
 * legitimately contain the very strings these guards hunt for: the tests plant
 * violations as oracles, and `_falsify_gates.script.ts` plants them on purpose
 * to prove these guards can fail. Scanning them would make the guards fire on
 * their own falsification harness, which is how this exclusion was discovered.
 *
 * The exclusion is safe because neither kind of file is reachable from the
 * application: nothing in `lib/` or `app/` imports a test or a script, and
 * guard 4 asserts nothing outside imports this directory at all.
 */
const isTestOrScript = (p: string) => /\.(test|script)\.ts$/.test(p);
const ENGINE = walk(HERE).filter((p) => !isTestOrScript(p));

describe('liveness · the scanner read the engine', () => {
  it('found every engine file', () => {
    expect(ENGINE.length).toBeGreaterThanOrEqual(10);
    expect(ENGINE.some((p) => p.endsWith('evaluate.ts'))).toBe(true);
  });

  it('ORACLE · planted violations are all detected', () => {
    expect(writesIn('const q = `UPDATE plan_workouts SET distance_mi = 9`;'))
      .toEqual([{ verb: 'UPDATE', table: 'plan_workouts' }]);
    expect(writerNamesIn('await applyAdaptations(uid, []);')).toEqual(['applyAdaptations']);
    expect(IO_IMPORT_RE.test("import { pool } from '@/lib/db/pool';")).toBe(true);
    // And prose is not flagged.
    expect(writesIn('// never UPDATE plan_workouts here')).toEqual([]);
    expect(writerNamesIn('/* nothing calls applyAdaptations */')).toEqual([]);
  });
});

describe('guard 1 · no engine file issues any write', () => {
  for (const f of ENGINE) {
    it(path.relative(HERE, f), () => {
      expect(writesIn(readFileSync(f, 'utf8'))).toEqual([]);
    });
  }
});

describe('guard 2 · no engine file imports any means of writing', () => {
  for (const f of ENGINE) {
    it(path.relative(HERE, f), () => {
      const code = stripComments(readFileSync(f, 'utf8'));
      expect(IO_IMPORT_RE.test(code), `${path.relative(HERE, f)} imports I/O`).toBe(false);
      expect(code, 'names fetch').not.toMatch(/\bfetch\s*\(/);
      expect(code, 'reads process.env').not.toMatch(/process\.env/);
    });
  }
});

describe('guard 3 · no engine file names a plan writer', () => {
  for (const f of ENGINE) {
    it(path.relative(HERE, f), () => {
      expect(writerNamesIn(readFileSync(f, 'utf8'))).toEqual([]);
    });
  }
});

describe('guard 4 · nothing outside imports this engine, nested paths included', () => {
  const OUTSIDE = [...walk(path.join(WEB, 'lib')), ...walk(path.join(WEB, 'app'))]
    .filter((p) => !p.startsWith(HERE + path.sep));

  it('liveness · the outside world was actually scanned', () => {
    expect(OUTSIDE.length).toBeGreaterThan(200);
  });

  it('ORACLE · a nested import is detected, which the pre-existing gate misses', () => {
    const planted = "import { evaluateAdaptation } from '@/lib/adaptation/canonical/evaluate';";
    expect(/@\/lib\/adaptation\/canonical/.test(stripComments(planted))).toBe(true);
    // The pre-existing flat-path ratchet cannot see it. Demonstrated, not
    // asserted in prose, so the claim in this file's header is checkable.
    const FLAT = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+'(@\/lib\/adaptation\/[a-z-]+)'/g;
    expect([...planted.matchAll(FLAT)].length).toBe(0);
  });

  it('no file outside this directory references it', () => {
    for (const f of OUTSIDE) {
      const code = stripComments(readFileSync(f, 'utf8'));
      expect(code, `${path.relative(WEB, f)} imports the canonical engine`)
        .not.toMatch(/@\/lib\/adaptation\/canonical/);
    }
  });
});

describe('guard 5 · the entry point is pure, demonstrated by running it', () => {
  it('the same input produces a byte-identical result, and mutates nothing', () => {
    const input = baseInput({ weeks: threeGoodWeeks(), longRuns: twoGoodLongRuns() });
    const snapshot = JSON.stringify(input);

    const a = evaluateAdaptation(input);
    const b = evaluateAdaptation(input);

    // Determinism. This is also the core of the idempotency guarantee: the same
    // evidence evaluated twice cannot produce two different answers.
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // The input is untouched. A function that rewrote its own argument would be
    // one refactor away from rewriting a plan object it was handed.
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('a refusal is a returned record, never a throw', () => {
    const unreadable = baseInput({ readable: false });
    const out = evaluateAdaptation(unreadable);
    expect(out.records).toHaveLength(3);
    expect(out.records.every((r) => r.decision === 'REFUSE')).toBe(true);
    // And it still explains itself.
    expect(out.records.every((r) => r.reason.length > 0)).toBe(true);
    expect(out.records.every((r) => r.whatWouldChangeIt.length > 0)).toBe(true);
  });

  it('no record ever proposes a change to completed history', () => {
    const input = baseInput({
      weeks: threeGoodWeeks(),
      longRuns: twoGoodLongRuns(),
    });
    for (const r of evaluateAdaptation(input).records) {
      expect(r.planDiff.touchesCompletedHistory).toBe(false);
      const inv = r.invariants.find((i) => i.id === 'INV_COMPLETED_HISTORY_IMMUTABLE');
      if (inv) expect(inv.passed).toBe(true);
    }
  });
});
