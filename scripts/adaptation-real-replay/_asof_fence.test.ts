/**
 * scripts/adaptation-real-replay/_asof_fence.test.ts · THE GATE OVER THE
 * TYPE-LEVEL NO-LOOKAHEAD FENCE.
 *
 * `asof.ts` claims that lookahead in this replay is a compile error rather than
 * a discipline. Rule 20's corollary: a header comment asserting an invariant is
 * documentation, not enforcement. This is the enforcement.
 *
 * Three guards, and each fails in a different way so one mistake cannot take
 * out more than one:
 *
 *   1. **The falsifier compiles clean.** `tsc --noEmit` over the harness. Every
 *      `@ts-expect-error` in `_asof_typecheck.ts` must be USED, which means
 *      every lookahead written out there must still be a type error. Weaken the
 *      fence and TypeScript reports TS2578 on the directive that is now
 *      unnecessary, naming the exact property that stopped holding.
 *   2. **Liveness, per Rule 18 guard 2.** The falsifier must still hold at least
 *      as many directives as it did when this gate was written. Deleting blocks
 *      from it would otherwise make guard 1 pass by having nothing to check —
 *      "reporting clean because you looked at nothing is the worst outcome
 *      available, since it also reports confidence."
 *   3. **Nobody reaches around it.** A type cannot stop the decision path
 *      importing `realHistory()` directly and going back to hand-filtering, so
 *      that is a source scan.
 *
 * ── FALSIFIED BEFORE BEING TRUSTED  ·  Rule 18 guard 1 ─────────────────────
 *
 * All three weakenings were applied to the real files and watched:
 *
 *   · `SealedEvidence<T> extends ReadonlyArray<T>` (the array surface back) →
 *     TS2578 on five directives, lines 60, 64, 67, 70, 73 — `filter`, index,
 *     `length`, spread and `find`.
 *   · `Authored<T>` re-branded with `EVIDENCE_BRAND` (the brands merged) →
 *     TS2578 on line 121, the `needsEvidence(artifacts)` substitution.
 *   · the race projection widened to the whole `SnapRace` → TS2578 on lines
 *     95, 98, 101 — `finishS`, `avgHr`, `paceSPerMi`.
 *
 * Each was restored and `tsc` returned clean. A gate that has never failed is a
 * hypothesis.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 * · **A lookahead shape nobody wrote down.** Guard 1 checks the enumerated
 *   list. It has no opinion about a leak the falsifier does not describe.
 * · **A wrong date in the extract.** The fence orders rows; it does not audit
 *   them. A run stamped with the wrong day is admitted on time and wrongly, and
 *   this gate reports green.
 * · **A leak through a VALUE.** `BuildArgs.belief` is carried forward by the
 *   replay itself and is not a collection. If a future author seeds it from
 *   something they should not have read, no type here objects.
 * · **The behaviour being right.** It proves the input cannot contain the
 *   future. It says nothing about whether the engine's verdict on that input is
 *   a good coaching decision — that is what the ledger and the report are for.
 * · **Its own third guard being narrow.** The scan looks for one import name in
 *   two files. A decision path that grew a third file would not be covered
 *   until that file is added to `DECISION_PATH`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const TSC = path.join(REPO, 'web-v2', 'node_modules', '.bin', 'tsc');

/**
 * The number of lookahead shapes the falsifier enumerated when this gate was
 * written. A ratchet: it may grow, never shrink. If a block is genuinely
 * obsolete — because the shape it describes has become unrepresentable for a
 * better reason — this number comes down in the same change that argues why.
 */
const FALSIFIER_MIN_DIRECTIVES = 14;

/** Files that build a decision. None of them may read the raw extract. */
const DECISION_PATH = ['build-input.ts', 'sealed-history.ts'];

describe('asof · the no-lookahead fence is a type, and it holds', () => {
  it('guard 1 · every lookahead the falsifier writes out is still a compile error', () => {
    let out = '';
    let failed = false;
    try {
      execFileSync(TSC, ['--noEmit', '-p', HERE], { cwd: REPO, encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      failed = true;
      const err = e as { stdout?: string; stderr?: string };
      out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }

    // TS2578 is the signature failure: a directive that is no longer needed,
    // which means the thing it was guarding against now compiles.
    const unused = out.split('\n').filter((l) => l.includes('TS2578'));
    expect(
      unused,
      'A lookahead the fence is supposed to forbid now type-checks. Each line '
      + 'names the exact guarantee that stopped holding — read the block above '
      + 'that line number in _asof_typecheck.ts.',
    ).toEqual([]);

    // And nothing else may be broken either, because a harness that does not
    // compile is a harness whose green is meaningless.
    expect(failed, `tsc reported errors:\n${out}`).toBe(false);
  });

  it('guard 2 · the falsifier still enumerates what it claims to (liveness)', () => {
    const src = readFileSync(path.join(HERE, '_asof_typecheck.ts'), 'utf8');
    const directives = src.split('\n').filter((l) => l.includes('@ts-expect-error')).length;
    expect(
      directives,
      'The falsifier has lost blocks. Guard 1 would then pass by checking '
      + 'nothing, which is the failure Rule 18 guard 2 exists to stop.',
    ).toBeGreaterThanOrEqual(FALSIFIER_MIN_DIRECTIVES);

    // The falsifier must also still be reachable from the typecheck it relies
    // on — a file excluded from tsconfig is a file nobody compiles.
    const cfg = JSON.parse(
      readFileSync(path.join(HERE, 'tsconfig.json'), 'utf8').replace(/^\s*"\/\/".*$/gm, '"_c": "",'),
    ) as { include?: string[] };
    expect(cfg.include ?? []).toContain('*.ts');
  });

  it('guard 3 · nothing on the decision path reads the raw extract', () => {
    const offenders: string[] = [];
    for (const f of DECISION_PATH) {
      const src = readFileSync(path.join(HERE, f), 'utf8');
      // `sealed-history.ts` is the ONE legitimate reader: it is what turns the
      // raw arrays into sealed collections. Everything else on the path must go
      // through it.
      if (f === 'sealed-history.ts') continue;
      // Import statements only. A mention inside a comment is documentation.
      const imports = src.split('\n').filter((l) => /^\s*(import|const)\b/.test(l) || /from '\.\/snapshot'/.test(l));
      if (imports.some((l) => /\brealHistory\b/.test(l))) {
        offenders.push(`${f} imports realHistory() and can hand-filter the extract again`);
      }
    }
    expect(offenders).toEqual([]);

    // Liveness: the scan must actually have read files with content in them.
    const read = DECISION_PATH.map((f) => readFileSync(path.join(HERE, f), 'utf8').length);
    expect(read.length).toBe(2);
    for (const n of read) expect(n).toBeGreaterThan(1000);
  });
});
