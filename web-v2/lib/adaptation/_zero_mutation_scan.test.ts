/**
 * lib/adaptation/_zero_mutation_scan.test.ts · THE ADAPTATION ENGINE CANNOT
 * WRITE A PLAN ROW, proven from source.
 *
 * The shadow-compare audit proves zero mutation EMPIRICALLY, on one account,
 * over the read-only role, with a checksum. This file proves it STRUCTURALLY,
 * for every file in this directory, on every build, with no database:
 *
 *   1 · No non-test file under lib/adaptation issues a write against any table
 *       but `adaptation_shadow_log` (the log this layer owns).
 *   2 · No non-test file under lib/adaptation names a plan writer —
 *       `applyAdaptations`, `tryAdaptiveBump`, `mutatePlan`, … — in code.
 *       Prose may mention them; the scanner strips comments first.
 *   3 · The only NON-TYPE imports of lib/adaptation from outside it are three
 *       named, read-only entry points. This is the ratchet: wiring
 *       `resolveAdaptationProposals` or an `AdaptationProposalSet` into a
 *       mutating module fails the build here, whatever the module does with it.
 *   4 · The cron route reads the shadow result for its `.error` and nothing
 *       else — a proposal never reaches `applyAdaptations` or
 *       `writeWorkoutProposals` through it.
 *   5 · The `deferred` proposals are read by nothing outside this directory.
 *
 * Rule 18 · liveness and an oracle: the scanner states how many files it read
 * and fails on too few, and a planted `UPDATE plan_workouts` must be flagged.
 * Rule 22 · what this file CANNOT fail on: a write reached through a function
 * imported from OUTSIDE this directory whose name is not in `PLAN_WRITERS`
 * (`detectAdaptations` is imported and trusted to be a detector — the RO-role
 * audit is what proves that one), and a write issued through a string built
 * at run time. It scans source, not behaviour; the audit test is the other half.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const HERE = __dirname;
const WEB = path.resolve(HERE, '..', '..');

/** The one table this layer may write. */
const OWNED_TABLES = new Set(['adaptation_shadow_log']);

/** Every function in this codebase that writes a plan row, or reaches one. */
export const PLAN_WRITERS = [
  'applyAdaptations', 'tryAdaptiveBump', 'actionForAdaptiveRamp', 'planUpgrade',
  'applyProgressionReshape', 'mutatePlan', 'reanchorActivePlan', 'recomputePacesForPlan',
  'refreshRaceRowsForPlan', 'generatePlan', 'persistComposedPlan', 'fireAutoRebuild',
  'writeWorkoutProposals', 'reanchorLthr', 'rebuildActivePlanForPrefs',
] as const;

/**
 * The ratchet · the ONLY non-type imports of `@/lib/adaptation/*` permitted
 * outside this directory. Shrinks, never grows without an argued entry.
 */
const PERMITTED_EXTERNAL_IMPORTS: ReadonlyArray<{ file: string; module: string; names: string[]; why: string }> = [
  {
    file: 'app/api/coach/read/route.ts', module: '@/lib/adaptation/load', names: ['readAdaptation'],
    why: 'reads the absorption verdict to render it; a classifier read, no proposal, no write',
  },
  {
    file: 'app/api/cron/prune-adaptation-shadow-log/route.ts', module: '@/lib/adaptation/shadow-log-retention',
    names: ['pruneAdaptationShadowLog'],
    why: 'DELETE-only against adaptation_shadow_log, the table this layer owns',
  },
  {
    file: 'app/api/cron/run-adaptations/route.ts', module: '@/lib/adaptation/shadow-compare',
    names: ['runAndPersistPaceShadowCompare'],
    why: 'the shadow cycle; its result is read for `.error` only (guard 4)',
  },
];

/**
 * Blank out line comments and block comments so PROSE cannot trip a code scan.
 * Block comments are replaced space-for-space so reported offsets stay honest.
 *
 * The line-comment pattern refuses to fire when the two slashes are preceded by
 * a colon, a quote or a backtick, which is what keeps a URL and a regex literal
 * out of its jaws. `\x60` is the backtick, written as an escape so this file
 * has no stray delimiter of its own.
 */
export function stripComments(src: string): string {
  const BLOCK = new RegExp('/\\*[\\s\\S]*?\\*/', 'g');
  const LINE = new RegExp('(^|[^:\'"\\x60])//[^\\n]*', 'g');
  return src
    .replace(BLOCK, (m) => m.replace(/[^\n]/g, ' '))
    .replace(LINE, (_m, p1: string) => p1);
}

const WRITE_RE = /\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi;

/** Every write verb + table in a source, comments stripped. Pure, so the oracle can call it. */
export function writesIn(src: string): Array<{ verb: string; table: string }> {
  const out: Array<{ verb: string; table: string }> = [];
  const code = stripComments(src);
  for (const m of code.matchAll(WRITE_RE)) out.push({ verb: m[1].toUpperCase().replace(/\s+/g, ' '), table: m[2] });
  return out;
}

export function writerNamesIn(src: string): string[] {
  const code = stripComments(src);
  return PLAN_WRITERS.filter((w) => new RegExp(`\\b${w}\\b`).test(code));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('._') || name === 'node_modules' || name === '.next') continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const isTestOrScript = (p: string) => /\.(test|script|audit\.test|harness\.test)\.ts$/.test(p);

const ADAPTATION_FILES = walk(HERE).filter((p) => !isTestOrScript(p));
const OUTSIDE_FILES = [...walk(path.join(WEB, 'lib')), ...walk(path.join(WEB, 'app'))]
  .filter((p) => !p.startsWith(HERE + path.sep) && !isTestOrScript(p));

describe('liveness · the scanner read real files', () => {
  it('found the engine, the loader, the shadow layer and the outside world', () => {
    expect(ADAPTATION_FILES.length).toBeGreaterThanOrEqual(9);
    expect(ADAPTATION_FILES.some((p) => p.endsWith('adaptation-engine.ts'))).toBe(true);
    expect(ADAPTATION_FILES.some((p) => p.endsWith('shadow-compare.ts'))).toBe(true);
    expect(OUTSIDE_FILES.length).toBeGreaterThan(200);
  });

  it('ORACLE · a planted plan write and a planted writer name are both flagged', () => {
    const planted = `const q = \`UPDATE plan_workouts SET distance_mi = 9 WHERE id = $1\`;\nawait applyAdaptations(uid, []);`;
    expect(writesIn(planted)).toEqual([{ verb: 'UPDATE', table: 'plan_workouts' }]);
    expect(writerNamesIn(planted)).toEqual(['applyAdaptations']);
    // And prose is NOT flagged — the strip works.
    const prose = `// never UPDATE plan_workouts here\n/* nothing calls applyAdaptations */\nconst x = 1;`;
    expect(writesIn(prose)).toEqual([]);
    expect(writerNamesIn(prose)).toEqual([]);
  });
});

describe('guard 1 · no write against any table but the shadow log', () => {
  for (const file of ADAPTATION_FILES) {
    it(path.relative(WEB, file), () => {
      const writes = writesIn(readFileSync(file, 'utf8'));
      const foreign = writes.filter((w) => !OWNED_TABLES.has(w.table));
      expect(foreign, `${path.relative(WEB, file)} writes ${JSON.stringify(foreign)}`).toEqual([]);
    });
  }
});

describe('guard 2 · no plan writer is named in code under lib/adaptation', () => {
  for (const file of ADAPTATION_FILES) {
    it(path.relative(WEB, file), () => {
      expect(writerNamesIn(readFileSync(file, 'utf8'))).toEqual([]);
    });
  }
});

describe('guard 3 · the ratchet on who may import this layer', () => {
  const IMPORT_RE = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+'(@\/lib\/adaptation\/[a-z-]+)'/g;
  const DYNAMIC_RE = /import\('(@\/lib\/adaptation\/[a-z-]+)'\)/g;

  const found: Array<{ file: string; module: string; names: string[] }> = [];
  for (const file of OUTSIDE_FILES) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(IMPORT_RE)) {
      if (m[1]) continue; // `import type` · a type cannot write
      const names = m[2].split(',').map((s) => s.trim()).filter(Boolean)
        .filter((n) => !n.startsWith('type '));
      if (names.length > 0) found.push({ file: path.relative(WEB, file), module: m[3], names });
    }
    for (const m of src.matchAll(DYNAMIC_RE)) {
      found.push({ file: path.relative(WEB, file), module: m[1], names: ['<dynamic>'] });
    }
  }

  it('every non-type import from outside is on the permitted list', () => {
    for (const f of found) {
      const ok = PERMITTED_EXTERNAL_IMPORTS.find((p) => p.file === f.file && p.module === f.module);
      expect(ok, `${f.file} imports ${f.names.join(', ')} from ${f.module}`).toBeTruthy();
      for (const n of f.names) expect(ok!.names, `${f.file}: ${n}`).toContain(n);
    }
  });

  it('the permitted list has no stale entry · the ratchet only shrinks', () => {
    for (const p of PERMITTED_EXTERNAL_IMPORTS) {
      const live = found.find((f) => f.file === p.file && f.module === p.module);
      expect(live, `${p.file} no longer imports ${p.module} · delete its entry`).toBeTruthy();
    }
  });

  it('liveness · the outside world does import this layer', () => {
    expect(found.length).toBeGreaterThanOrEqual(3);
  });
});

describe('guard 4 · the cron route reads the shadow result for its error and nothing else', () => {
  it('run-adaptations never hands a shadow result to a writer', () => {
    const src = stripComments(readFileSync(path.join(WEB, 'app/api/cron/run-adaptations/route.ts'), 'utf8'));
    const uses = [...src.matchAll(/\bshadow\b(?!-)/g)].length;
    expect(uses).toBeGreaterThan(0); // liveness
    // Every use of the identifier is the assignment or `.error`.
    const legit = [...src.matchAll(/const shadow = await runAndPersistPaceShadowCompare|shadow\.error/g)].length;
    expect(legit).toBe(uses);
    for (const w of ['applyAdaptations', 'writeWorkoutProposals', 'tryAdaptiveBump']) {
      expect(src).not.toMatch(new RegExp(`${w}\\([^)]*shadow`));
    }
  });
});

describe('guard 5 · deferred proposals are non-mutable by construction', () => {
  it('nothing outside lib/adaptation reads `.deferred`', () => {
    for (const file of OUTSIDE_FILES) {
      const src = stripComments(readFileSync(file, 'utf8'));
      expect(src, path.relative(WEB, file)).not.toMatch(/\.deferred\b/);
    }
  });

  it('inside, the only readers are the contradiction checker and the PACE record', () => {
    const readers = ADAPTATION_FILES.filter((f) => /\.deferred\b/.test(stripComments(readFileSync(f, 'utf8'))));
    expect(readers.map((f) => path.basename(f)).sort()).toEqual(['adaptation-engine.ts', 'shadow-compare.ts']);
  });
});
