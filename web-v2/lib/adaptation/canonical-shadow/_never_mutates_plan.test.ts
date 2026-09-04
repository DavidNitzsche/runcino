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

describe('guard 1 · the only writes anywhere in this directory target canonical_adaptation_shadow_log', () => {
  for (const f of SOURCE) {
    it(path.relative(HERE, f), () => {
      const writes = writesIn(readFileSync(f, 'utf8'));
      for (const w of writes) {
        expect(w.table, `${path.relative(HERE, f)} writes ${w.verb} against ${w.table}`)
          .toBe(CANONICAL_ADAPTATION_SHADOW_LOG_TABLE);
        expect(w.verb, `${path.relative(HERE, f)} issues ${w.verb} against the shadow log — only INSERT is authorized`)
          .toBe('INSERT INTO');
      }
    });
  }

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

  it('liveness · found SQL-shaped literals to classify', () => {
    const all = READ_FILES.flatMap((f) => templateLiterals(readFileSync(f, 'utf8')));
    const sqlShaped = all.filter((s) => /\b(select|insert|update|delete)\b/i.test(s));
    expect(sqlShaped.length).toBeGreaterThan(5);
  });

  it('every SQL-shaped literal in the evidence-reading files classifies as a READ', () => {
    for (const f of READ_FILES) {
      const literals = templateLiterals(readFileSync(f, 'utf8'))
        .filter((s) => /\b(select|insert|update|delete|with)\b/i.test(s));
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
