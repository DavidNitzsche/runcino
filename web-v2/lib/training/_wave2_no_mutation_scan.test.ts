/**
 * lib/training/_wave2_no_mutation_scan.test.ts
 *
 * Q7 · PROOF THAT NO ROUTE THROUGH THE WAVE-2 FILES CAN REPRICE A WORKOUT,
 * MUTATE A PLAN, OR REOPEN THE 2026-09-02 `recompute_paces` SEAM.
 *
 * Extends the single-file scan `_resolve_current_fitness.test.ts` carries into
 * a whole-set scan, and adds the thing that file could not do: a REACHABILITY
 * walk. A one-hop import check is not proof — Rule 19 was earned on exactly
 * that, when a `'use client'` component reached `pg` through an edge THREE
 * modules deep and dynamic, every gate stayed green, and production did not
 * deploy for a day. So this walks the transitive closure of each wave-2
 * file's own imports (static AND dynamic) and fails if any of them reaches a
 * mutation module.
 *
 * ── LIVENESS (Rule 18) ─────────────────────────────────────────────────────
 *
 * Every guard states how many files it read and fails on zero. A scan that
 * reports clean because it looked at nothing is the worst available outcome,
 * because it also reports confidence. `check-modelled-mark.sh` shipped
 * exactly that.
 *
 * ── WHAT THIS SUITE CANNOT FAIL ON (Rule 22) ────────────────────────────────
 *
 * · A MUTATION REACHED THROUGH A STRING BUILT AT RUNTIME.
 *   `await import(someVariable)` defeats a static walk. Guard 4 fails any
 *   non-literal dynamic import in the wave-2 set, which closes the hole for
 *   THESE files and cannot close it for the modules they import.
 * · A MUTATION PERFORMED BY A MODULE THAT IS ALREADY ON THE ALLOWED SIDE.
 *   `capacity-resolver.ts` is a read-only resolver today; if it grew a write
 *   tomorrow, this scan would not notice, because it stops at the frontier
 *   rather than auditing the whole engine.
 * · WHETHER THE PROPOSAL IS A GOOD IDEA. It proves only that it is INERT.
 * · A HUMAN WIRING IT LATER. Guard 5 asserts nothing outside the wave-2 set
 *   imports these files TODAY. The moment somebody does, this test fails —
 *   which is the intent (adoption should have to delete an assertion, out
 *   loud), but it is a tripwire, not a lock.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';

const LIB = resolve(__dirname, '..');
const WEB_V2 = resolve(LIB, '..');

/** Every file this proposal adds, plus the one it is a review OF. The
 *  reviewed file is included deliberately: Q7 asks for proof about BOTH. */
const WAVE2_FILES = [
  'training/resolve-current-fitness.ts',
  'training/fitness-decision-identity.ts',
  'training/current-fitness-contract.ts',
  'training/detector-fitness-posture.ts',
];

/** Modules that can move a plan, reprice a workout, or reopen the seam.
 *  Matched against a RESOLVED path, so a mention in prose cannot trip it. */
const MUTATION_MODULES = [
  'lib/plan/mutate',
  'lib/plan/adapt',
  'lib/plan/adaptation-authority',
  'lib/plan/recompute-paces',
  'lib/plan/reanchor-plan',
  'lib/plan/generate',
  'lib/brain/mutation/authority',
  'lib/brain/proposal/accept',
  'lib/brain/proposal/execute',
  'lib/brain/proposal/write',
  'lib/brain/orchestration/move-orchestrator',
];

function src(rel: string): string {
  const p = join(LIB, rel);
  expect(existsSync(p), `wave-2 file missing: ${rel}`).toBe(true);
  return readFileSync(p, 'utf8');
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Import specifiers, static and dynamic, from real syntax only — never from a
 * comment. Comments are stripped first, because every one of these files NAMES
 * the modules it avoids in its own header, and a whole-file substring match
 * cannot tell that apart from using them.
 *
 * ── `import type` IS NOT AN EDGE, AND GETTING THAT WRONG COST THIS GATE ────
 *
 * The first version of this walk did not distinguish them and reported a
 * mutation module reachable from `resolve-current-fitness.ts` down this chain:
 *
 *   resolve-current-fitness → capacity-resolver → plan/spec-builder
 *     → training/prescription-resolver → training/runner-state → plan/adapt
 *
 * Two of those four hops are `import type` (`spec-builder.ts:62` and
 * `prescription-resolver.ts:143`), which TypeScript erases entirely — no
 * runtime edge, no module load, nothing to call. A type-only chain is exactly
 * the false positive a reachability gate must not produce, because a gate that
 * cries wolf gets an allowlist entry rather than a fix, and the allowlist is
 * then the hole. Falsifying this guard is what surfaced it (Rule 18), and the
 * finding is recorded in the proposal rather than quietly patched.
 *
 * The distinction is only sound because these files are compiled by `tsc`
 * with `import type` semantics, and because a value import written as
 * `import { type X }` inline still reports the module — this parser is
 * deliberately conservative there and treats any import whose specifier list
 * is not wholly type-only as an edge.
 */
function importSpecifiers(text: string): {
  specs: string[];
  typeOnly: string[];
  nonLiteralDynamic: number;
} {
  const code = stripComments(text);
  const specs: string[] = [];
  const typeOnly: string[] = [];
  // Static imports, with the clause captured so `import type` can be told
  // apart from `import`.
  //
  // `[^;]*?` rather than `[\s\S]*?` — a clause cannot cross a statement
  // terminator. The lazy any-character version over-matched: it let an
  // unrelated earlier `export const …` span forward and swallow a LATER
  // import's specifier, which made a type-only import of a mutation module
  // report as a value edge. Found by falsifying this gate against exactly
  // that case (Rule 18), and it is the more dangerous half of the lesson —
  // an over-matching detector earns an allowlist entry, and the allowlist is
  // then the hole.
  for (const m of code.matchAll(/\bimport\s+(type\s+)?([^;]*?)\bfrom\s*['"]([^'"]+)['"]/g)) {
    const isTypeKeyword = m[1] != null;
    const clause = m[2];
    // `import { type A, type B } from 'x'` is also erased. `import { type A, B }`
    // is NOT — one value binding makes it a real edge.
    const braced = clause.match(/\{([\s\S]*)\}/);
    const allBindingsTyped = braced != null
      && braced[1].split(',').map((s) => s.trim()).filter(Boolean).length > 0
      && braced[1].split(',').map((s) => s.trim()).filter(Boolean).every((b) => /^type\s/.test(b));
    if (isTypeKeyword || allBindingsTyped) typeOnly.push(m[3]);
    else specs.push(m[3]);
  }
  // `export {…} from` / `export * from` re-exports a VALUE and is a real
  // edge. Anchored to the two forms that can actually carry one, so it cannot
  // start at an unrelated `export const` and run forward into someone else's
  // specifier.
  for (const m of code.matchAll(
    /\bexport\s+(?!type\b)(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g,
  )) {
    specs.push(m[1]);
  }
  for (const m of code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]);
  for (const m of code.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]);
  const nonLiteralDynamic = [...code.matchAll(/\bimport\s*\(\s*(?!['"])/g)].length;
  return { specs, typeOnly, nonLiteralDynamic };
}

/** `@/x` → `<web-v2>/x`; relative → resolved. Anything else (a bare package)
 *  is returned as-is and is never a repo module. */
function resolveSpec(spec: string, fromFileAbs: string): string | null {
  if (spec.startsWith('@/')) return join(WEB_V2, spec.slice(2));
  if (spec.startsWith('.')) return resolve(dirname(fromFileAbs), spec);
  return null;
}

function existingTsPath(base: string): string | null {
  for (const p of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * A template literal is SQL iff it OPENS with a SQL statement verb.
 *
 * The first version keyed on `/\bFROM\b/i` anywhere in the literal and
 * immediately failed on an English sentence — "…answered 47.5 from sourceMode
 * 'direct'…" — which is the other half of Rule 18's lesson: a detector that
 * over-matches gets loosened, and a loosened detector is how the real thing
 * gets through next time. Keying on the opening verb is exact for this
 * codebase (every SQL literal in `web-v2/lib` opens with one) and cannot be
 * satisfied by prose.
 */
const SQL_OPENER = /^\s*(SELECT|WITH|INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/i;

describe('GUARD 1 · no mutation verb in any SQL any wave-2 file issues', () => {
  it('every SQL template literal opens with SELECT and carries no mutation verb', () => {
    let scannedFiles = 0;
    let scannedLiterals = 0;
    for (const rel of WAVE2_FILES) {
      const text = stripComments(src(rel));
      scannedFiles++;
      const literals = [...text.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
      const sql = literals.filter((l) => SQL_OPENER.test(l));
      for (const q of sql) {
        scannedLiterals++;
        expect(q, `${rel}: SQL literal is not a SELECT`).toMatch(/^\s*SELECT\b/i);
        expect(q, `${rel}: SQL literal carries a mutation verb`)
          .not.toMatch(/\b(UPDATE|INSERT|DELETE|TRUNCATE|ALTER|DROP)\b/i);
      }
    }
    expect(scannedFiles).toBe(WAVE2_FILES.length);
    // Liveness. At least one wave-2 file really does issue SQL — if that
    // stops being true this guard has become decorative and should say so.
    expect(scannedLiterals).toBeGreaterThan(0);
  });
});

describe('GUARD 2 · no direct import of a mutation module', () => {
  it('no wave-2 file imports one, in prose OR in syntax', () => {
    let checked = 0;
    for (const rel of WAVE2_FILES) {
      const { specs } = importSpecifiers(src(rel));
      checked++;
      for (const s of specs) {
        for (const m of MUTATION_MODULES) {
          expect(s.replace(/^@\//, 'lib/').replace(/^\.\.\//, 'lib/'),
            `${rel} imports ${s}`).not.toContain(m.replace(/^lib\//, ''));
        }
      }
    }
    expect(checked).toBe(WAVE2_FILES.length);
  });
});

describe('GUARD 3 · TRANSITIVE reachability — the Rule 19 guard', () => {
  it('no mutation module is reachable from any wave-2 file at any depth', () => {
    const seen = new Set<string>();
    const frontier: { abs: string; via: string[] }[] = WAVE2_FILES.map((rel) => ({
      abs: join(LIB, rel), via: [rel],
    }));
    let visited = 0;
    let maxDepth = 0;

    while (frontier.length > 0) {
      const node = frontier.shift()!;
      if (seen.has(node.abs)) continue;
      seen.add(node.abs);
      visited++;
      maxDepth = Math.max(maxDepth, node.via.length);

      const relToWebV2 = node.abs.slice(WEB_V2.length + 1).replace(/\.tsx?$/, '');
      for (const m of MUTATION_MODULES) {
        expect(relToWebV2, `mutation module reached via ${node.via.join(' -> ')}`).not.toBe(m);
      }

      if (!existsSync(node.abs)) continue;
      const { specs } = importSpecifiers(readFileSync(node.abs, 'utf8'));
      for (const s of specs) {
        const base = resolveSpec(s, node.abs);
        if (base == null) continue;
        // A mutation module is checked BEFORE resolution too, so a module
        // that exists only as a `.d.ts` or is otherwise unresolvable here
        // cannot slip past.
        const asRel = base.slice(WEB_V2.length + 1);
        for (const m of MUTATION_MODULES) {
          expect(asRel, `mutation module named via ${[...node.via, s].join(' -> ')}`)
            .not.toBe(m);
        }
        const p = existingTsPath(base);
        if (p != null && !seen.has(p)) frontier.push({ abs: p, via: [...node.via, s] });
      }
    }
    // Liveness, and a real number rather than "> 0": the walk must actually
    // have gone somewhere. `capacity-resolver.ts` alone pulls in a large
    // subtree, so a collapse to single digits means the walk broke.
    expect(visited).toBeGreaterThan(30);
    expect(maxDepth).toBeGreaterThan(2);
  });
});

describe('GUARD 4 · no runtime-computed dynamic import, which would defeat guard 3', () => {
  it('every `import(...)` in a wave-2 file takes a string literal', () => {
    let checked = 0;
    for (const rel of WAVE2_FILES) {
      const { nonLiteralDynamic } = importSpecifiers(src(rel));
      checked++;
      expect(nonLiteralDynamic, `${rel} has a non-literal dynamic import`).toBe(0);
    }
    expect(checked).toBe(WAVE2_FILES.length);
  });
});

describe('GUARD 5 · nothing outside the wave-2 set imports these files (the tripwire)', () => {
  it('the proposal is unwired, measured by grep over the whole repo', () => {
    const names = [
      'resolve-current-fitness',
      'fitness-decision-identity',
      'current-fitness-contract',
      'detector-fitness-posture',
    ];
    let hits = 0;
    for (const n of names) {
      let out = '';
      try {
        out = execFileSync(
          'grep',
          ['-rl', '--include=*.ts', '--include=*.tsx', n, join(WEB_V2, 'lib'), join(WEB_V2, 'app')],
          { encoding: 'utf8' },
        );
      } catch {
        out = ''; // grep exits 1 on no match
      }
      const files = out.split('\n').filter(Boolean).map((f) => f.slice(WEB_V2.length + 1));
      for (const f of files) {
        hits++;
        const isWave2 =
          WAVE2_FILES.some((w) => f === `lib/${w}`)
          || /^lib\/training\/_(?:resolve_current_fitness|fitness_decision_identity|current_fitness_contract|detector_fitness_posture|wave2_no_mutation_scan)\.test\.ts$/.test(f);
        expect(isWave2, `${f} references ${n} — the proposal is no longer unwired`).toBe(true);
      }
    }
    // Liveness: the grep found the files themselves. Zero hits would mean the
    // scan matched nothing and reported clean, which is the failure this
    // whole file exists to avoid.
    expect(hits).toBeGreaterThanOrEqual(names.length);
  });
});

describe('GUARD 6 · `._numbers` is not read outside the contract that owns it', () => {
  it('only current-fitness-contract.ts and its own test touch the escape hatch', () => {
    let out = '';
    try {
      out = execFileSync(
        'grep', ['-rl', '--include=*.ts', '_numbers', join(WEB_V2, 'lib'), join(WEB_V2, 'app')],
        { encoding: 'utf8' },
      );
    } catch { out = ''; }
    const candidates = out.split('\n').filter(Boolean);
    // Comments are stripped before the check. Two of this proposal's own test
    // headers DISCUSS `._numbers` in the Rule 22 "what this cannot enforce"
    // note, and a gate that cannot tell a warning about a hazard from the
    // hazard is the citation-scrub defect Rule 18 catalogues.
    const files = candidates
      .filter((abs) => /(^|[.\s(])_numbers\b/.test(stripComments(readFileSync(abs, 'utf8'))))
      .map((f) => f.slice(WEB_V2.length + 1))
      // The scanner names its own target in its grep argument. A gate that
      // reports itself is the `check-modelled-mark.sh` shape inverted, and
      // excluding it is a statement about THIS file rather than an allowlist
      // entry anyone else can join.
      .filter((f) => f !== 'lib/training/_wave2_no_mutation_scan.test.ts');
    const ALLOWED = new Set(['lib/training/current-fitness-contract.ts']);
    for (const f of files) {
      expect(ALLOWED.has(f), `${f} reads ._numbers directly, bypassing withCurrentFitness`).toBe(true);
    }
    // Ratchet + liveness: the allowlist may shrink, never grow, and the scan
    // must have found the owning file in CODE, not only in prose.
    expect(files).toContain('lib/training/current-fitness-contract.ts');
  });
});
