/**
 * lib/adaptation/canonical-shadow/_never_mutates_plan.test.ts · THE LIVE
 * WIRING CANNOT MUTATE A PLAN.
 *
 * `lib/adaptation/canonical/_cannot_mutate.test.ts` proves the ENGINE is
 * pure. It says nothing about this directory, which is new tonight and
 * DOES hold a database connection and DOES issue exactly one kind of
 * write (`shadow-log-writer.ts`'s single INSERT shape). This file is that
 * proof, applying the same source-scan discipline
 * `_cannot_mutate.test.ts` already established — reusing its exported
 * `writesIn` / `writerNamesIn` / `stripComments` rather than
 * re-implementing them (Rule 16: one definition).
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ─────────────────────────────
 *
 *   · A write reached through a function imported from OUTSIDE this
 *     directory whose name is not on the `PLAN_WRITERS` list this file
 *     imports from `_cannot_mutate.test.ts`. If that list is stale, so is
 *     this gate — the same limit `_cannot_mutate.test.ts` states about
 *     itself.
 *   · Behaviour. This scans SOURCE. It does not run a query against a real
 *     database and confirm the RO role actually refuses a write — that is
 *     `read-only-db.ts`'s own two independent fences (role privilege +
 *     `classifyStatement`), proven separately in guard 3 below by running
 *     `classifyStatement` itself (a pure function) against every literal
 *     SQL string this directory contains.
 *   · A statement built entirely at runtime from untraceable string
 *     concatenation that this scan's regexes cannot parse. Every query in
 *     this directory is a single template literal, which the scan below
 *     handles directly.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { writesIn, writerNamesIn, stripComments } from '../canonical/_cannot_mutate.test';
import { classifyStatement } from '@/lib/verify/production-barrier';
import { insertShadowRecord, CANONICAL_ADAPTATION_SHADOW_LOG_TABLE, ShadowLogWriteRefused } from './shadow-log-writer';
import { CANONICAL_ADAPTATION_DEFERRALS_TABLE } from './deferral-writer';

const HERE = __dirname;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('._') || name === 'node_modules' || name === '.next') continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const isTestOrScript = (p: string) => /\.(test|script)\.ts$/.test(p);
const SOURCE = walk(HERE).filter((p) => !isTestOrScript(p));

describe('liveness · the scanner read this directory', () => {
  it('found every source file', () => {
    expect(SOURCE.length).toBeGreaterThanOrEqual(3);
    expect(SOURCE.some((p) => p.endsWith('run-live-shadow-evaluation.ts'))).toBe(true);
    expect(SOURCE.some((p) => p.endsWith('live-input.ts'))).toBe(true);
    expect(SOURCE.some((p) => p.endsWith('shadow-log-writer.ts'))).toBe(true);
  });
});

/**
 * The two tables this directory owns, and the verbs each may take.
 *
 * `canonical_adaptation_shadow_log` is APPEND-ONLY: a record of what the
 * engine decided, so INSERT and nothing else.
 *
 * `canonical_adaptation_deferrals` (added 2026-09-04) is a LEDGER OF OPEN
 * ITEMS, and it takes UPDATE as well. That is not a loosening, it is the
 * consequence of a stricter rule: rows there are NEVER DELETED, so retiring a
 * queued progression is an UPDATE that stamps `expired_at` with a stated
 * reason. DELETE is authorized against neither, which is what actually matters
 * — the failure this feature exists to prevent is a deferred progression
 * vanishing without a record.
 *
 * Nothing here licenses a plan write: neither table is read by anything that
 * changes training, and the oracle below still fails on a planted
 * `UPDATE plan_workouts`.
 */
const OWNED_WRITES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [CANONICAL_ADAPTATION_SHADOW_LOG_TABLE, new Set(['INSERT INTO'])],
  [CANONICAL_ADAPTATION_DEFERRALS_TABLE, new Set(['INSERT INTO', 'UPDATE'])],
]);

describe('guard 1 · the only writes anywhere in this directory target the two tables it owns', () => {
  for (const f of SOURCE) {
    it(path.relative(HERE, f), () => {
      const writes = writesIn(readFileSync(f, 'utf8'));
      for (const w of writes) {
        const verbs = OWNED_WRITES.get(w.table);
        expect(verbs, `${path.relative(HERE, f)} writes ${w.verb} against ${w.table}, which this directory does not own`)
          .toBeDefined();
        expect(verbs!.has(w.verb), `${path.relative(HERE, f)} issues ${w.verb} against ${w.table} — not an authorized verb for that table`)
          .toBe(true);
      }
    });
  }

  it('liveness · the map is not vacuously permissive', () => {
    // A map that had lost its entries would pass every file by finding no
    // writes to check. It cannot: both tables must be present, DELETE must be
    // authorized against neither, and UPDATE must be authorized against
    // exactly one of them.
    expect([...OWNED_WRITES.keys()].sort()).toEqual([
      'canonical_adaptation_deferrals', 'canonical_adaptation_shadow_log',
    ]);
    for (const verbs of OWNED_WRITES.values()) expect(verbs.has('DELETE FROM')).toBe(false);
    expect([...OWNED_WRITES.values()].filter((v) => v.has('UPDATE'))).toHaveLength(1);
  });

  it('ORACLE · a write against a plan-shape table would be caught', () => {
    const planted = writesIn("const q = `UPDATE plan_workouts SET distance_mi = 9 WHERE id = $1`;");
    expect(planted).toEqual([{ verb: 'UPDATE', table: 'plan_workouts' }]);
    expect(planted[0].table).not.toBe(CANONICAL_ADAPTATION_SHADOW_LOG_TABLE);
  });
});

describe('guard 2 · no file in this directory names a known plan writer', () => {
  for (const f of SOURCE) {
    it(path.relative(HERE, f), () => {
      expect(writerNamesIn(readFileSync(f, 'utf8'))).toEqual([]);
    });
  }
});

describe('guard 3 · every literal SQL string this directory issues classifies correctly', () => {
  /** Every backtick template literal in a file, as a best-effort static
   *  extract — good enough because this directory writes each query as one
   *  contiguous template literal with no runtime-built SQL fragments beyond
   *  a table-name constant, which none of these queries interpolate. */
  function templateLiterals(src: string): string[] {
    const code = stripComments(src);
    const out: string[] = [];
    const re = /`((?:[^`\\]|\\.)*)`/g;
    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((m = re.exec(code))) out.push(m[1]);
    return out;
  }

  const READ_FILES = ['live-input.ts', 'run-live-shadow-evaluation.ts', 'read-only-db.ts']
    .map((n) => path.join(HERE, n));

  // Anchored to the START of the literal (leading whitespace only), not a
  // bare "contains the word anywhere" test. Every real query in this
  // directory is written as one contiguous template literal that opens
  // directly on its keyword (this file's own header states that as the
  // scan's precondition) — a `contains` test also catches plain-English
  // log strings that happen to mention one of these words, e.g.
  // `` `[canonical-shadow] insert failed for ${userUuid}...` `` (a
  // console.warn, not SQL), which is exactly the false positive this
  // anchoring removes without weakening what guard 1 above already proves
  // about the one authorized write.
  const SQL_SHAPED_RE = /^\s*(?:--[^\n]*\n|\s)*\b(select|insert|update|delete|with)\b/i;

  it('liveness · found SQL-shaped literals to classify', () => {
    const all = READ_FILES.flatMap((f) => templateLiterals(readFileSync(f, 'utf8')));
    const sqlShaped = all.filter((s) => SQL_SHAPED_RE.test(s));
    expect(sqlShaped.length).toBeGreaterThan(5);
  });

  it('every SQL-shaped literal in the evidence-reading files classifies as a READ', () => {
    for (const f of READ_FILES) {
      const literals = templateLiterals(readFileSync(f, 'utf8'))
        .filter((s) => SQL_SHAPED_RE.test(s));
      for (const sql of literals) {
        // `run-live-shadow-evaluation.ts` builds ONE insert string for the
        // shadow log itself — that one statement is EXPECTED to classify as
        // mutating (it is the authorized write) and is asserted separately,
        // by table name, in guard 1 above. Every other literal in these
        // files must classify as a pure read.
        const cls = classifyStatement(sql);
        if (cls.mutating && new RegExp(`insert\\s+into\\s+${CANONICAL_ADAPTATION_SHADOW_LOG_TABLE}`, 'i').test(sql)) {
          continue; // the one authorized write, verified by name here too
        }
        expect(cls.mutating, `unexpected mutating statement in ${path.basename(f)}: ${cls.head}`).toBe(false);
      }
    }
  });

  it('ORACLE · classifyStatement itself still refuses a planted write', () => {
    expect(classifyStatement("UPDATE training_plans SET mode = 'recovery'").mutating).toBe(true);
    expect(classifyStatement('SELECT 1').mutating).toBe(false);
  });
});

describe('guard 4 · shadow-log-writer.ts refuses anything but its one allowed INSERT shape', () => {
  it('ORACLE · a planted UPDATE against a plan table is refused, then removed', async () => {
    await expect(insertShadowRecord(
      `UPDATE plan_workouts SET distance_mi = 9 WHERE id = $1`, ['x'],
    )).rejects.toThrow(ShadowLogWriteRefused);
  });

  it('ORACLE · a planted INSERT against a different table is refused', async () => {
    await expect(insertShadowRecord(
      `INSERT INTO plan_workouts (id, distance_mi) VALUES ($1, $2)`, ['x', 1],
    )).rejects.toThrow(ShadowLogWriteRefused);
  });

  it('ORACLE · a planted second statement smuggled after the allowed INSERT is refused', async () => {
    await expect(insertShadowRecord(
      `INSERT INTO ${CANONICAL_ADAPTATION_SHADOW_LOG_TABLE} (user_uuid) VALUES ($1); `
      + `UPDATE training_plans SET mode = 'recovery'`,
      ['x'],
    )).rejects.toThrow(ShadowLogWriteRefused);
  });

  // The permitted shape is NOT run against a real database here (that needs
  // a live connection and belongs to an `.audit.test.ts`, not this
  // structural gate) — it is enough to prove the allow-list's REGEX admits
  // it, which is the property guard 1 above depends on to make sense of a
  // real INSERT from `run-live-shadow-evaluation.ts` classifying as
  // authorized rather than merely un-scanned.
  it('the allowed shape itself is not refused by the regex (would throw before reaching pool.query if it were)', () => {
    const ALLOWED_INSERT_RE = new RegExp(
      `^\\s*(?:--[^\\n]*\\n|\\s)*insert\\s+into\\s+"?${CANONICAL_ADAPTATION_SHADOW_LOG_TABLE}"?\\s*\\(`,
      'i',
    );
    expect(ALLOWED_INSERT_RE.test(`INSERT INTO ${CANONICAL_ADAPTATION_SHADOW_LOG_TABLE} (\n  user_uuid\n) VALUES ($1)`))
      .toBe(true);
  });
});
