/**
 * SHADOWOBS-1 · THE GATE ON "EVERY EXIT IS INSTRUMENTED".
 *
 * David, 2026-09-05: "Instrument every exit... Do not return 'cause unknown'
 * again if the running system can be instrumented and observed safely."
 *
 * A taxonomy is a hypothesis until something checks that the code actually
 * uses it (Rule 20). This file is that check. It derives the set of exit codes
 * the shipping code CONSTRUCTS, from source, and compares it against the
 * closed set `shadow-exit.ts` declares — so a code that exists only as a type
 * fails, and a call site that invents a code the taxonomy does not carry fails
 * to compile before it gets here.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (CLAUDE.md Rule 22) ─────────────────────
 *
 *   · It cannot fail on an exit path that RETURNS WITHOUT AN EXIT AT ALL. It
 *     reads which codes are constructed, not whether every `return` carries
 *     one. Guard 6 narrows that specific hole — it counts `return` statements
 *     against `shadowExit(` calls in the entry point — but a future early
 *     return added elsewhere in the file is caught by that count only, not by
 *     any structural understanding of control flow.
 *   · It cannot fail on a WRONG code being chosen for a real situation. It
 *     proves `INPUT_READ_FAILED` is reachable; it cannot prove the read
 *     failure that happens in production reaches it rather than
 *     `INPUT_MISSING`. Only `_live_shadow_probe.script.ts`, run against real
 *     data, can say that.
 *   · It cannot fail on `DATABASE_URL_RO` being unset in production. That is
 *     an environment fact, not a source fact. It is what the mechanism this
 *     file gates would REPORT; nothing in this repo can assert it.
 *   · It cannot fail on the alert actually reaching a human. It proves the
 *     `raiseAlert` call exists in the cron and that the severity is decided
 *     by `summarisePass`; it cannot prove anyone reads `ops_alerts`.
 *   · Rule 22's distribution question: this file's assertions split 4 on the
 *     "a defect must be loud" side and 4 on the "an honest nothing must stay
 *     quiet" side, deliberately. A gate that only ever asked "did you alert?"
 *     would pass a mechanism that alerts on everything, which is the same
 *     silence by a different route.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  SHADOW_EXITS, ALL_SHADOW_EXIT_CODES, shadowExit, summarisePass,
  type ShadowExitCode,
} from './shadow-exit';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const ENTRY = 'lib/adaptation/canonical-shadow/run-live-shadow-evaluation.ts';
const LOADER = 'lib/adaptation/canonical-shadow/live-input.ts';
const CRON = 'app/api/cron/run-adaptations/route.ts';

/** Every `shadowExit('CODE'` and every `refusalCode: 'CODE'` in a file. */
function codesConstructedIn(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/shadowExit\(\s*'([A-Z_]+)'/g)) out.add(m[1]);
  for (const m of src.matchAll(/refusalCode:\s*'([A-Z_]+)'/g)) out.add(m[1]);
  return out;
}

describe('SHADOWOBS-1 · the exit taxonomy is live, complete and honest', () => {
  /* ── LIVENESS (Rule 18) ────────────────────────────────────────────────
   * A scanner states how much it read and fails on zero. This repo has
   * shipped gates that reported clean because they scanned nothing. */
  it('guard 0 · reads the three real files, and none of them is empty', () => {
    const sizes = [ENTRY, LOADER, CRON].map((f) => read(f).length);
    expect(sizes).toHaveLength(3);
    for (const [i, n] of sizes.entries()) {
      expect(n, `${[ENTRY, LOADER, CRON][i]} is empty`).toBeGreaterThan(2000);
    }
    expect(ALL_SHADOW_EXIT_CODES.length).toBe(10);
  });

  it('guard 1 · every declared exit code is CONSTRUCTED by shipping code', () => {
    // Rule 15 · a mechanism the code cannot reach is decoration, however
    // completely it is typed. `EVALUATION_ERROR` is also constructed in the
    // cron's own catch, which is why CRON is in this union.
    const constructed = new Set([
      ...codesConstructedIn(read(ENTRY)),
      ...codesConstructedIn(read(LOADER)),
      ...codesConstructedIn(read(CRON)),
    ]);
    const unreachable = ALL_SHADOW_EXIT_CODES.filter((c) => !constructed.has(c));
    expect(unreachable, `declared but never constructed: ${unreachable.join(', ')}`).toEqual([]);
  });

  it('guard 2 · no call site invents a code the taxonomy does not carry', () => {
    const declared = new Set<string>(ALL_SHADOW_EXIT_CODES);
    const constructed = [
      ...codesConstructedIn(read(ENTRY)),
      ...codesConstructedIn(read(LOADER)),
      ...codesConstructedIn(read(CRON)),
    ];
    // Belt to `tsc`'s braces: the compiler already rejects an unknown literal,
    // but only while the parameter stays typed. A future `string` widening
    // would silently reopen this.
    for (const c of constructed) expect(declared.has(c), `undeclared exit code ${c}`).toBe(true);
  });

  it('guard 3 · exactly the DEFECT codes carry a remedy', () => {
    // The load-bearing invariant. A DEFECT with no remedy is an alert that
    // tells an operator something is broken and not what to do, which is how
    // an alert becomes noise and then becomes ignored.
    for (const code of ALL_SHADOW_EXIT_CODES) {
      const spec = SHADOW_EXITS[code];
      if (spec.health === 'DEFECT') {
        expect(spec.remedy, `${code} is a DEFECT with no remedy`).toBeTruthy();
        expect((spec.remedy ?? '').length, `${code}'s remedy is too short to act on`)
          .toBeGreaterThan(40);
      } else {
        expect(spec.remedy, `${code} is not a DEFECT but carries a remedy`).toBeNull();
      }
    }
  });

  it('guard 4 · the three facts Rule 11 forbids collapsing have three codes', () => {
    // "No active plan", "input missing" and "the read failed" — David's own
    // three, plus the belief case. The point is not that four codes exist; it
    // is that they land on DIFFERENT SIDES of the health verdict, because that
    // is the only distinction an alert can act on.
    expect(SHADOW_EXITS.NO_ACTIVE_PLAN.health).toBe('EXPECTED');
    expect(SHADOW_EXITS.INPUT_MISSING.health).toBe('EXPECTED');
    expect(SHADOW_EXITS.BELIEF_CONFLICT.health).toBe('EXPECTED');
    expect(SHADOW_EXITS.INPUT_READ_FAILED.health).toBe('DEFECT');
    expect(SHADOW_EXITS.EVALUATION_REFUSAL.health).toBe('EXPECTED');
    expect(SHADOW_EXITS.EVALUATION_ERROR.health).toBe('DEFECT');
    expect(SHADOW_EXITS.PERSISTENCE_UNAVAILABLE.health).toBe('DEFECT');
    expect(SHADOW_EXITS.PERSISTENCE_FAILED.health).toBe('DEFECT');
    expect(SHADOW_EXITS.NO_RO_CONNECTION.health).toBe('DEFECT');
    expect(SHADOW_EXITS.WROTE.health).toBe('OK');
  });

  it('guard 5 · the loader no longer swallows the race read, and no longer discards its own reason', () => {
    const src = read(LOADER);
    // The swallowed catch that made a thrown read look like a missing race.
    expect(src).not.toContain('} catch { /* handled below as "no race" */ }');
    expect(src).toContain('let raceReadFailed: string | null = null;');
    // `buildUnreadableInput` took the failure message as `_reason` and never
    // used it, then returned `refusal: null`.
    expect(src, 'buildUnreadableInput still discards its reason').not.toContain('_reason: string,');
    expect(src).toContain("refusalCode: 'INPUT_READ_FAILED',");
  });

  it('guard 6 · every return in the entry point carries an exit', () => {
    const src = read(ENTRY);
    const fn = src.slice(src.indexOf('export async function runAndPersistCanonicalShadowEvaluation('));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 3);
    const returns = (body.match(/\n\s+return \{/g) ?? []).length;
    const exits = (body.match(/exit: shadowExit\(/g) ?? []).length;
    expect(returns, 'the entry point returns nothing — the slice is wrong').toBeGreaterThan(5);
    expect(exits, `${returns} returns but only ${exits} carry an exit`).toBe(returns);
  });

  it('guard 7 · the cron COLLECTS the exit and raises one alert per pass', () => {
    // Rule 20 · the mount is the thing that was missing, not the mechanism.
    // The mechanism was wired, tested and correct on 2026-09-03; what nobody
    // could see was its result. A gate on the module alone would have passed
    // throughout the outage.
    const src = read(CRON);
    expect(src).toContain('canonicalShadowExits.push(canonicalShadow.exit)');
    expect(src).toContain('summarisePass(canonicalShadowExits)');
    expect(src).toContain("kind: 'canonical_shadow_exit'");
    // Severity is decided by `summarisePass`, never re-derived at the call
    // site (Rule 16 — one quantity, one owner).
    expect(src).toContain('severity: canonicalShadowPass.severity');
    expect(src).not.toMatch(/kind: 'canonical_shadow_exit',\s*\n\s*severity: '(info|warn|error)'/);
    // And the alert kind is declared, or `raiseAlert` would not typecheck.
    expect(read('lib/ops/alerts.ts')).toContain("| 'canonical_shadow_exit'");
  });

  /* ── THE PASS VERDICT ──────────────────────────────────────────────────── */

  it('guard 8 · a pass over ZERO athletes is an error, not a quiet night', () => {
    const v = summarisePass([]);
    expect(v.severity).toBe('error');
    expect(v.athletes).toBe(0);
    expect(v.message).toContain('ZERO athletes');
    // Every code present as an explicit zero, not omitted.
    expect(Object.keys(v.byCode).sort()).toEqual([...ALL_SHADOW_EXIT_CODES].sort());
  });

  it('guard 9 · one DEFECT among many healthy athletes still raises error, and names the remedy', () => {
    const v = summarisePass([
      shadowExit('WROTE', 'wrote', { recordsEvaluated: 3, recordsPersisted: 3 }),
      shadowExit('WROTE', 'wrote', { recordsEvaluated: 3, recordsPersisted: 3 }),
      shadowExit('INPUT_READ_FAILED', 'the runs read threw'),
    ]);
    expect(v.severity).toBe('error');
    expect(v.defects).toBe(1);
    expect(v.recordsPersisted).toBe(6);
    expect(v.message).toContain('INPUT_READ_FAILED');
    expect(v.message).toContain('Remedy:');
  });

  it('guard 10 · a pass where every runner honestly had nothing is warn, never info', () => {
    // The distribution half of Rule 22. This is the case the old reporting got
    // wrong in the other direction: it was silent, so two days of writing
    // nothing looked exactly like two days of healthy quiet.
    const v = summarisePass([
      shadowExit('NO_ACTIVE_PLAN', 'no plan'),
      shadowExit('INPUT_MISSING', 'no race'),
      shadowExit('BELIEF_CONFLICT', 'no anchor'),
    ]);
    expect(v.severity).toBe('warn');
    expect(v.defects).toBe(0);
    expect(v.recordsPersisted).toBe(0);
    expect(v.byCode.NO_ACTIVE_PLAN).toBe(1);
    expect(v.byCode.WROTE).toBe(0);
  });

  it('guard 11 · rows landing is info, and the histogram says how many', () => {
    const v = summarisePass([
      shadowExit('WROTE', 'wrote', { recordsEvaluated: 3, recordsPersisted: 3 }),
      shadowExit('EVALUATION_REFUSAL', 'all refused', { recordsEvaluated: 3, recordsPersisted: 3 }),
      shadowExit('NO_ACTIVE_PLAN', 'no plan'),
    ]);
    expect(v.severity).toBe('info');
    expect(v.recordsPersisted).toBe(6);
    expect(v.message).toContain('WROTE×1');
    expect(v.message).toContain('EVALUATION_REFUSAL×1');
  });

  it('guard 12 · WROTE with zero records evaluated is a contradiction the counts expose', () => {
    // Liveness at the record level: an exit claiming the healthy path while
    // having looked at nothing is exactly the shape Rule 18 warns about, and
    // the counts are what make it visible rather than plausible.
    const e = shadowExit('WROTE', 'wrote', { recordsEvaluated: 0, recordsPersisted: 0 });
    expect(e.recordsEvaluated).toBe(0);
    const v = summarisePass([e]);
    expect(v.severity, 'a pass that persisted nothing must not read as info').toBe('warn');
  });

  it('guard 13 · the taxonomy has both a healthy and a broken side, in balance', () => {
    // Rule 22 · count the sides. A taxonomy that was all DEFECT would alert on
    // every quiet night; one that was all EXPECTED could not alert at all, and
    // that second failure is the one that actually happened.
    const defects = ALL_SHADOW_EXIT_CODES.filter((c) => SHADOW_EXITS[c].health === 'DEFECT');
    const quiet = ALL_SHADOW_EXIT_CODES.filter((c) => SHADOW_EXITS[c].health !== 'DEFECT');
    expect(defects.length).toBeGreaterThanOrEqual(4);
    expect(quiet.length).toBeGreaterThanOrEqual(4);
  });

  it('guard 14 · a code cannot silently change health without this file noticing', () => {
    // The ratchet. Flipping NO_RO_CONNECTION to EXPECTED would restore the
    // exact 2026-09 silence, and it is a one-word edit.
    const pinned: Partial<Record<ShadowExitCode, 'OK' | 'EXPECTED' | 'DEFECT'>> = {
      NO_RO_CONNECTION: 'DEFECT',
      INPUT_READ_FAILED: 'DEFECT',
      PERSISTENCE_UNAVAILABLE: 'DEFECT',
      PERSISTENCE_FAILED: 'DEFECT',
      EVALUATION_ERROR: 'DEFECT',
    };
    for (const [code, health] of Object.entries(pinned)) {
      expect(SHADOW_EXITS[code as ShadowExitCode].health, `${code} changed health`).toBe(health);
    }
  });
});
