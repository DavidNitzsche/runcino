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

/** The tables this layer may write. `canonical_adaptation_shadow_log`
 *  (added 2026-09-03) is the sibling shadow log for the canonical
 *  Adaptation Engine's live evaluation (`canonical-shadow/run-live-shadow-
 *  evaluation.ts`) — same shape as `adaptation_shadow_log`, one allow-
 *  listed INSERT, proven separately and more tightly by that directory's
 *  own `_never_mutates_plan.test.ts`. Argued exemption, not a widened
 *  hole: this scan only proves NO OTHER table is touched. */
/* `reassessment_schedule` (migration 167, 2026-09-05 — it replaced the
 * unapplied `reassessment_schedule` of migration 165 rather than
 * sitting beside it, so the app has one durable queue and not three) is the
 * durable half of `canonical/deferral-queue.ts` — the ledger of progressions
 * arbitration DEFERRED, so one survives a process restart and is reconsidered
 * at the next boundary instead of evaporating. Argued exemption, on the same
 * terms as the two above and no wider:
 *
 *   · It is a table this layer OWNS. Nothing else in the app reads or writes
 *     it, and nothing reads it to change a plan — a queued item is re-offered
 *     to the engine, never applied. `AUTOMATIC_ADAPTATION_AUTHORITY` is
 *     untouched.
 *   · Its writes go through ONE fenced client (`canonical-shadow/
 *     deferral-writer.ts`), which allow-lists exactly two statement shapes
 *     against exactly this table and refuses everything else before the wire.
 *   · UPDATE is authorized against it, which it is not against either shadow
 *     log, and the reason is structural: rows here are never deleted, so
 *     retiring an item is an UPDATE that stamps a terminal `status` with a
 *     stated reason. A DELETE would lose the distinction between "retired because
 *     the block ended" and "silently vanished", which is the whole point.
 *
 * This scan still proves NO OTHER TABLE is touched. */
const OWNED_TABLES = new Set([
  'adaptation_shadow_log', 'canonical_adaptation_shadow_log', 'reassessment_schedule',
]);

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
    file: 'app/api/cron/prune-adaptation-shadow-log/route.ts', module: '@/lib/adaptation/canonical-adaptation-shadow-log-retention',
    names: ['pruneCanonicalAdaptationShadowLog'],
    why:
      'DELETE-only against canonical_adaptation_shadow_log — the scaled sibling of the entry '
      + 'above, same route, same retention shape (age + per-user row cap), added 2026-09-03 '
      + 'alongside the canonical engine\'s live shadow evaluation.',
  },
  {
    file: 'app/api/cron/run-adaptations/route.ts', module: '@/lib/adaptation/shadow-compare',
    names: ['runAndPersistPaceShadowCompare'],
    why: 'the shadow cycle; its result is read for `.error` only (guard 4)',
  },
  {
    file: 'app/api/cron/snapshot-projections/route.ts', module: '@/lib/adaptation/authoring-convergence',
    names: ['<dynamic>'],
    why:
      'Rule 23\'s alert, not a proposal. `alertOnUnconvergedPlan` re-resolves the convergence '
      + 'state AFTER the reanchor has had its turn and raises an ops_alerts row for a plan '
      + 'nothing is pricing. It returns a state string the route only logs; the alert write is '
      + 'to ops_alerts, never to a plan. This is the loudness Rule 23 requires and the reason '
      + 'the fifth convergence state exists at all.',
  },
  {
    file: 'lib/prescription/trajectory.ts', module: '@/lib/adaptation/adaptation-model',
    names: ['classifyAdaptation'],
    why:
      'AUTHORING\'s neutral verdict. `authoringAdaptation()` calls the classifier on an '
      + 'all-null input to get the "no evidence yet, proceed as planned" verdict the overload '
      + 'trajectory is drawn against before a runner has any history. A classifier read, not a '
      + 'proposal, and this file writes no plan row (guard 3b covers the writers). It reads '
      + 'band and stepMultiplier only, so the `evidenceSufficient` field added in this pass '
      + 'does not change what it authors.',
  },
  {
    file: 'lib/plan/adapt.ts', module: '@/lib/adaptation/load', names: ['<dynamic>'],
    why:
      'THE ONE SEAM WHERE THIS LAYER REACHES A MUTATION, and it is not a proposal. '
      + '`detectProgressionGate` reads the ABSORPTION VERDICT (`readAdaptation` -> '
      + '`classifyAdaptation`) and hands it to `resolveWeekProgression`, whose resolutions '
      + 'become a `progression_gate` action that `applyAdaptations` writes. That path is the '
      + 'shipped density mechanism and PREDATES the Adaptation Engine; the verdict is a '
      + 'classifier output, not an `AdaptationProposal`, and nothing here can reach '
      + '`composeAdaptation`. Guard 3b is what actually holds the shadow boundary: no plan '
      + 'writer may import the PROPOSAL path at all. Recorded rather than exempted quietly '
      + 'because it is the one place a change to `adaptation-model.ts` can reach a runner\'s '
      + 'plan, and a future edit to that file must know it.',
  },
];

/**
 * The PROPOSAL path — what may never reach a plan writer. Distinct from the
 * absorption classifier above, which legitimately does (via the progression
 * gate) and always has.
 */
const PROPOSAL_PATH_MODULES = [
  '@/lib/adaptation/adaptation-engine',
  '@/lib/adaptation/load-adaptation-engine',
  '@/lib/adaptation/shadow-compare',
] as const;

const PROPOSAL_PATH_SYMBOLS = [
  'composeAdaptation', 'resolveAdaptationProposals', 'runPaceShadowCompareCycle',
  'AdaptationProposalSet', 'AdaptationProposal',
] as const;

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

/**
 * `ON CONFLICT ... DO UPDATE SET` is the upsert half of the INSERT it belongs
 * to, and names no table of its own. Without this, `WRITE_RE` reads it as an
 * UPDATE against a table called `SET` — a phantom write against a table that
 * does not exist. Added 2026-09-04 with this layer's first upsert
 * (`canonical-shadow/deferral-store.ts`); the oracle below plants one.
 */
export function neutraliseUpsertClause(src: string): string {
  return src.replace(/\bdo\s+update\s+set\b/gi, 'do_upsert_set');
}

/** Every write verb + table in a source, comments stripped. Pure, so the oracle can call it. */
export function writesIn(src: string): Array<{ verb: string; table: string }> {
  const out: Array<{ verb: string; table: string }> = [];
  const code = neutraliseUpsertClause(stripComments(src));
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

  it('ORACLE · the upsert neutraliser hides the phantom, and NOTHING else', () => {
    // An upsert reports ONE write, against the INSERT's own table — not a
    // second one against a phantom table called `SET`.
    const upsert = 'const q = `INSERT INTO reassessment_schedule (a) VALUES ($1)'
      + ' ON CONFLICT (a) DO UPDATE SET a = 1`;';
    expect(writesIn(upsert)).toEqual([
      { verb: 'INSERT INTO', table: 'reassessment_schedule' },
    ]);

    // FALSIFICATION, both directions. A REAL second statement smuggled after
    // an upsert is still caught, so the neutraliser has not opened a hole —
    // it rewrites exactly the four tokens `DO UPDATE SET` and nothing wider.
    const smuggled = 'const q = `INSERT INTO reassessment_schedule (a) VALUES ($1)'
      + ' ON CONFLICT (a) DO UPDATE SET a = 1; UPDATE plan_workouts SET distance_mi = 9`;';
    expect(writesIn(smuggled)).toContainEqual({ verb: 'UPDATE', table: 'plan_workouts' });

    // And a plain UPDATE is untouched by it.
    expect(neutraliseUpsertClause('UPDATE plan_workouts SET x = 1'))
      .toBe('UPDATE plan_workouts SET x = 1');
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

describe('guard 3b · no plan writer may import the PROPOSAL path, in any form', () => {
  // The property that actually holds the shadow boundary. Guard 3 rations WHO
  // may import this layer; this one says that whoever writes a plan row may not
  // touch the proposal path at all — not the functions, not even the types,
  // because a type is how a proposal gets threaded into a writer one refactor
  // before the call does.
  const planWriterFiles = OUTSIDE_FILES.filter((f) => {
    const src = readFileSync(f, 'utf8');
    return writesIn(src).some((w) => w.table === 'plan_workouts');
  });

  it('liveness · the plan writers were actually found', () => {
    expect(planWriterFiles.length).toBeGreaterThanOrEqual(5);
    expect(planWriterFiles.some((f) => f.endsWith('lib/plan/adapt.ts'))).toBe(true);
  });

  it('none of them names the proposal path', () => {
    for (const f of planWriterFiles) {
      const src = stripComments(readFileSync(f, 'utf8'));
      for (const m of PROPOSAL_PATH_MODULES) {
        expect(src, `${path.relative(WEB, f)} imports ${m}`).not.toContain(m);
      }
      for (const sym of PROPOSAL_PATH_SYMBOLS) {
        expect(src, `${path.relative(WEB, f)} names ${sym}`).not.toMatch(new RegExp(`\\b${sym}\\b`));
      }
    }
  });
});

describe('guard 4 · the cron route reads the shadow result for its error and nothing else', () => {
  it('run-adaptations never hands a shadow result to a writer', () => {
    const src = stripComments(readFileSync(path.join(WEB, 'app/api/cron/run-adaptations/route.ts'), 'utf8'));
    // (?<!-) added 2026-09-03 alongside (?!-): the canonical shadow pass logs
    // under the tag `[canonical-shadow]` and imports from a path segment
    // named `canonical-shadow/...`, both hyphen-joined compounds that are
    // log/path noise, not a bare identifier read — the same reasoning the
    // original (?!-) already applied to `[shadow-compare]`, made symmetric.
    const uses = [...src.matchAll(/(?<!-)\bshadow\b(?!-)/g)].length;
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
