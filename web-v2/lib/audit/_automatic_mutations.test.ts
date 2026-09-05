/**
 * A JOB MAY NOT CHANGE A RUNNER'S DATA WITHOUT DECLARING THAT IT DOES.
 *
 * ── The incident ────────────────────────────────────────────────────────────
 *
 * 2026-08-25, 09:29:32 UTC. `plan-drift` fired `long_drift`, archived the
 * owner's two-week recovery block mid-flight, and authored a one-week block in
 * its place. His week went from 23 miles to 38. Nothing on any surface said so.
 *
 * The audit that followed asked for an inventory of every scheduled job. The
 * inventory named two writers of the training plan. There were four. The one
 * nobody listed is `snapshot-projections` — a job whose name says it takes
 * snapshots and which calls `reanchorActivePlan`, rewriting
 * `plan_workouts.pace_target_s_per_mi` and `workout_spec` for every future
 * unsealed day, daily, for every active runner.
 *
 * A hand-written inventory would have missed it again on the next pass. So
 * this gate does not read the inventory and believe it. It derives the
 * plan-writer set FROM THE SOURCE and makes the two agree.
 *
 * ── Six guards ──────────────────────────────────────────────────────────────
 *
 *   0 · FLOORS      · the scan actually opened files and matched things. A
 *                     scanner that parses nothing reports a clean codebase,
 *                     which is this bug one level up.
 *   1 · SHAPE       · the registry parses, ids are unique and are not line
 *                     numbers, every `route` exists on disk, every non-
 *                     idempotent or invisible entry carries a `note`.
 *   2 · CRON COVER  · every directory under app/api/cron has an entry.
 *   3 · SCHED COVER · every workflow with a `schedule:` is either an entry or
 *                     an explicitly-argued non-mutator.
 *   4 · PLAN TRUTH  · the set of files that call `generatePlan(` or
 *                     `reanchorActivePlan(` from an AUTOMATIC path equals the
 *                     set the registry calls plan writers. This is the guard
 *                     that would have caught snapshot-projections.
 *   5 · ORACLE      · a planted defect the gate must fail. Proves guard 4 can
 *                     tell the difference rather than passing vacuously.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  AUTOMATIC_MUTATIONS,
  SCHEDULED_NON_MUTATORS,
  MUTATION_SCAN_FLOORS,
  planWriters,
  type AutomaticMutation,
} from './automatic-mutation-registry';
// One definition of "which function is this byte offset inside", shared with
// the swallowed-failure scanner rather than re-derived here (Rule 16).
import { maskSource, enclosingSymbol, lineAt } from './swallow-scan';

/** web-v2/ */
const WEB = resolve(__dirname, '../..');
/** repo root */
const ROOT = resolve(WEB, '..');

// ─────────────────────────────────────────────────────────────────────────────
// Scanning

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const SOURCE_FILES = [...walk(join(WEB, 'lib')), ...walk(join(WEB, 'app'))];

const cronRouteDirs = existsSync(join(WEB, 'app/api/cron'))
  ? readdirSync(join(WEB, 'app/api/cron')).filter((n) =>
      statSync(join(WEB, 'app/api/cron', n)).isDirectory())
  : [];

const workflowFiles = existsSync(join(ROOT, '.github/workflows'))
  ? readdirSync(join(ROOT, '.github/workflows')).filter((n) => n.endsWith('.yml'))
  : [];

const scheduledWorkflows = workflowFiles.filter((n) =>
  /^\s*-\s*cron:/m.test(readFileSync(join(ROOT, '.github/workflows', n), 'utf8')));

/**
 * Files that author or rewrite a plan from a path the runner did not tap.
 *
 * THREE SHAPES, because the first draft of this gate only knew one and was
 * wrong about two files within a minute of first running:
 *
 *   · `generatePlan(`        — replaces the whole block.
 *   · `reanchorActivePlan(`  — rewrites the paces inside one. THIS is the one
 *                              that hid: "rewrites every future prescribed
 *                              pace" did not look like "writes the plan" to
 *                              anyone reading the call site.
 *   · a direct write to `plan_workouts` — how `run-adaptations` actually moves
 *                              a session. It routes through `mutatePlan` and
 *                              never touches `generatePlan`, so a gate that
 *                              looked only for the first two declared it clean.
 *
 * Runner-initiated routes are excluded by path, not by guesswork: a route the
 * runner reaches by tapping a control is not this bug class. That exclusion
 * list is deliberately short and explicit, because "it's probably fine" is how
 * an automatic writer gets filed as a manual one.
 */
const RUNNER_INITIATED = [
  'app/api/plan/generate/route.ts',
  'app/api/plan/replan/route.ts',
  'app/api/plan/proposal/route.ts',
  'app/api/plan/restore/route.ts',
  'app/api/plan/workout/route.ts',
  'app/api/plan/workout/[id]/accept-standing/route.ts',
  'app/api/today/reschedule/route.ts',
  'app/api/coach/proposal/route.ts',
  'app/api/profile/goal/route.ts',
  'app/api/race/route.ts',
  'app/api/onboarding/complete/route.ts',
  'app/api/admin/backfill-workout-spec/route.ts',
];

/** The mutation boundary itself, and the onboarding seed. Neither decides
 *  anything; they execute what a caller already decided. Excluded so the
 *  mapping below stays a list of DECIDERS. */
const PLAN_INFRASTRUCTURE = [
  'lib/plan/mutate.ts',
  'lib/plan/seed-from-onboarding.ts',
];

/** Files that write plan rows and CANNOT run in production.
 *
 *  This gate's question is "which automatic trigger reaches this writer" — it
 *  is a map of what can change the runner's plan while nobody is watching. A
 *  module that refuses to execute unless `DATABASE_URL` names a local scratch
 *  database has no answer to that question, and forcing one would mean writing
 *  a false attribution into the very registry the gate exists to keep true.
 *
 *  The exclusion is narrow and is itself checked: `lib/adaptation-harness/*`
 *  calls `assertHarnessDatabase()` at module scope (fence.ts), which throws
 *  before a pool exists unless the connection string is loopback AND names the
 *  harness's own database; the directory is excluded from `vitest.config.ts`;
 *  and no route, cron or workflow imports it. The assertion below re-checks the
 *  first of those at gate time, so deleting the fence deletes the exclusion. */
const TEST_ONLY_FENCED = [
  'lib/adaptation-harness/substrate.ts',
];

function rel(abs: string): string {
  return abs.slice(WEB.length + 1);
}

/** The three shapes, applied to comment-stripped source. Exported so the
 *  planted-defect tests can drive the same predicate the gate uses, rather
 *  than a lookalike written next to it. */
export function writesAPlan(code: string): boolean {
  return /\bgeneratePlan\s*\(/.test(code)
    || /\breanchorActivePlan\s*\(/.test(code)
    // Multi-line SQL is normal here, so `[\s\S]` rather than `.` — a
    // single-line grep is one of the traps this codebase has actually hit.
    || /(UPDATE|INSERT\s+INTO|DELETE\s+FROM)[\s\S]{0,40}\bplan_workouts\b/i.test(code);
}

/** Comments removed, so a call site merely DISCUSSED in prose is not a call
 *  site. This test file itself is full of prose about generatePlan. */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/* ══════════════════════════════════════════════════════════════════════════
 * PER-STATEMENT SCANNING (2026-09-01)
 *
 * This gate used to derive plan writers at FILE granularity, and that is one
 * declaration covering an unbounded number of writes. Falsified exactly as the
 * audit demonstrated:
 *
 *   · a new file `lib/plan/_falsify-writer.ts` carrying
 *     `UPDATE plan_workouts SET pace_target_s_per_mi …`  → FAIL, names the file
 *   · the SAME statement appended to `lib/plan/reanchor-plan.ts`, which is
 *     already declared → **PASS**, "ok · 23 entries", "Tests 20 passed"
 *
 * The registry's five questions (`idempotent`, `onPartialFailure`,
 * `runnerSees`, `changes`, `trigger`) are answered per ENTRY. A second writer
 * added inside a declared file silently inherits answers that are now false
 * for it, and `reanchor-plan.ts` and `adapt.ts` are precisely the two files
 * most likely to grow one.
 *
 * The unit is now `<file>::<enclosingSymbol>`, resolved with the same
 * `maskSource` / `enclosingSymbol` pair `swallow-scan.ts` uses — one
 * definition of "which function is this statement in", not a second one
 * written next door (Rule 16).
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Blank COMMENT bodies while preserving every byte offset and newline.
 *
 * `maskSource` blanks comments AND string bodies, which is right for finding
 * code but wrong here: the SQL this gate hunts lives INSIDE a template
 * literal. So the two passes are used for different questions — this one to
 * find the statement (prose about `UPDATE plan_workouts` must not count), and
 * `maskSource` to resolve which function the offset falls in.
 */
export function blankComments(src: string): string {
  const n = src.length;
  const out = src.split('');
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      blank(i, j); i = j; continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      blank(i, Math.min(j + 2, n)); i = Math.min(j + 2, n); continue;
    }
    // Skip over string bodies so a `//` or `/*` inside one cannot open a
    // phantom comment — `'https://…'` is the everyday case.
    if (c === '`' || c === "'" || c === '"') {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) break;
        if (c !== '`' && src[j] === '\n') break;
        j++;
      }
      i = j + 1; continue;
    }
    i++;
  }
  return out.join('');
}

export type PlanWriteKind = 'generatePlan' | 'reanchorActivePlan' | 'UPDATE' | 'INSERT' | 'DELETE';

export interface PlanWriteSite {
  /** Repo-relative, e.g. `lib/plan/adapt.ts`. */
  file: string;
  /** 1-based line of the statement or call. */
  line: number;
  /** Enclosing function name, or `<module>` for a top-level statement. */
  symbol: string;
  /** `<file>::<symbol>` — the declaration key. Stable across edits above it. */
  id: string;
  kind: PlanWriteKind;
}

/** Every statement in one file that can change a plan row. */
export function scanPlanWriteSitesIn(file: string, src: string): PlanWriteSite[] {
  const code = blankComments(src);
  const masked = maskSource(src);
  const sites: PlanWriteSite[] = [];
  const add = (index: number, kind: PlanWriteKind, declaredName?: string) => {
    // A DECLARATION resolves to its own name, not to `<module>`. `export async
    // function generatePlan(` matches the call regex, and reporting the
    // implementation of the plan writer as a module-level statement would give
    // the two most important sites in the tree the least stable id available.
    const symbol = declaredName ?? enclosingSymbol(masked, index);
    sites.push({ file, line: lineAt(src, index), symbol, id: `${file}::${symbol}`, kind });
  };
  const isDeclaration = (index: number): boolean =>
    /(?:^|[^.\w$])(?:export\s+)?(?:async\s+)?function\s+$/.test(code.slice(Math.max(0, index - 40), index));
  for (const m of code.matchAll(/\bgeneratePlan\s*\(/g)) {
    add(m.index!, 'generatePlan', isDeclaration(m.index!) ? 'generatePlan' : undefined);
  }
  for (const m of code.matchAll(/\breanchorActivePlan\s*\(/g)) {
    add(m.index!, 'reanchorActivePlan', isDeclaration(m.index!) ? 'reanchorActivePlan' : undefined);
  }
  // Multi-line SQL is normal here, so `[\s\S]` rather than `.` — a single-line
  // grep is one of the traps this codebase has actually hit.
  for (const m of code.matchAll(/\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)[\s\S]{0,40}?\bplan_workouts\b/gi)) {
    const verb = m[1].toUpperCase().startsWith('INSERT') ? 'INSERT'
      : m[1].toUpperCase().startsWith('DELETE') ? 'DELETE' : 'UPDATE';
    add(m.index!, verb);
  }
  return sites;
}

export function scanPlanWriteSites(files: readonly string[]): PlanWriteSite[] {
  const out: PlanWriteSite[] = [];
  for (const abs of files) {
    const r = rel(abs);
    if (RUNNER_INITIATED.includes(r) || PLAN_INFRASTRUCTURE.includes(r)) continue;
    if (TEST_ONLY_FENCED.includes(r)) continue;
    out.push(...scanPlanWriteSitesIn(r, readFileSync(abs, 'utf8')));
  }
  return out.sort((a, b) => (a.id === b.id ? a.line - b.line : a.id.localeCompare(b.id)));
}

const PLAN_WRITE_SITES = scanPlanWriteSites(SOURCE_FILES);
/** Derived from the SAME scan, not from a second one. Two scanners that answer
 *  "which files write a plan" differently is how a gate starts disagreeing
 *  with itself (Rule 16). */
const PLAN_WRITER_FILES = [...new Set(PLAN_WRITE_SITES.map((s) => s.file))].sort();
const PLAN_WRITE_SITE_IDS = [...new Set(PLAN_WRITE_SITES.map((s) => s.id))].sort();

/**
 * Every STATEMENT that writes a plan, and which automatic trigger reaches it.
 *
 * Keyed on `<file>::<enclosingFunction>`, not on the file. It used to be the
 * file, and a file is one declaration covering an unbounded number of writes:
 * a second `UPDATE plan_workouts` appended inside `reanchor-plan.ts` inherited
 * that file's answers to the registry's five questions (`idempotent`,
 * `onPartialFailure`, `runnerSees`, `changes`, `trigger`) even though they were
 * now false for it, and the gate passed. Falsified and re-falsified; see the
 * PER-STATEMENT SCANNING note above.
 *
 * A value of `runner-initiated: <reason>` means this site is only ever reached
 * by a runner tapping something. That is an ARGUMENT, not an exclusion list —
 * it lives here, next to the automatic ones, and the gate requires it to be a
 * sentence. An exclusion with no reason is how a writer gets quietly filed as
 * harmless, which is the failure this whole gate exists to stop.
 *
 * Several triggers share one implementation, so the mapping is many-to-one and
 * stated rather than inferred.
 *
 * Every attribution below was established by reading the import graph. The
 * first draft of this map was written from a summary and the gate rejected two
 * of its entries within a minute, which is the argument for the gate.
 */
const PLAN_WRITER_SITE_OWNERS: Record<string, string> = {
  // Automatic.
  // 2026-08-28 · auto-rebuild.ts is reached by cron/plan-drift AND
  // cron/silent-rebuild (the latter routed through fireAutoRebuild so its
  // rebuild writes the undo-pairing proposal row; its route file no longer
  // calls generatePlan directly and so no longer registers in the scan —
  // the registry entry cron/silent-rebuild still declares the write).
  'lib/plan/auto-rebuild.ts::fireAutoRebuild': 'cron/plan-drift',
  'lib/plan/auto-rebuild.ts::rebuildActivePlanForPrefs': 'cron/plan-drift',
  'lib/plan/open-block.ts::authorOpenBlock': 'cron/plan-drift',
  'lib/plan/open-block.ts::authorNoTargetBlock': 'cron/plan-drift',
  // The implementation itself, and the function that writes its rows.
  'lib/plan/generate.ts::generatePlan': 'cron/plan-drift',
  'lib/plan/generate.ts::persistPlan': 'cron/plan-drift',
  'lib/race/result-chain.ts::runPostResultChain': 'cron/plan-drift',
  'app/api/cron/snapshot-projections/route.ts::snapshotForUser': 'cron/snapshot-projections',
  'lib/plan/reanchor-plan.ts::reanchorActivePlan': 'cron/snapshot-projections',
  'lib/plan/reanchor-plan.ts::reanchorMaintenance': 'cron/snapshot-projections',
  'lib/plan/recompute-paces.ts::core': 'cron/snapshot-projections',
  // 2026-09-01 · P0 · the dedicated race-row path. Reached standalone from the
  // daily snapshot cron (through mutatePlan, touches 'derivations') and INSIDE
  // recompute-paces' transaction (same owner, same trigger); authoring's
  // post-persist call runs under cron/plan-drift's boundary but the write is
  // the same idempotent derivation, so one owner describes it honestly.
  'lib/race/race-row-refresh.ts::refreshRaceRowsCore': 'cron/snapshot-projections',
  'lib/plan/adapt.ts::applyAdaptations': 'cron/run-adaptations',
  'lib/plan/adapt.ts::rebuildWorkoutDerivations': 'cron/run-adaptations',
  'lib/plan/progression-pass.ts::applyProgressionReshape': 'cron/run-adaptations',

  // Runner-initiated, each with the route that reaches it.
  // 2026-09-02 · SEALED, and re-pointed rather than deleted. The rename is real:
  // `buildInjuryPlan` is now a hardcoded refusal and the plan-writing body it
  // guards moved to `buildInjuryPlanBody`, so the id follows the statement the
  // way this registry's `<file>::<enclosingFunction>` rule requires.
  'lib/plan/injury-builder.ts::buildInjuryPlanBody':
    'runner-initiated: SEALED AND UNREACHABLE (2026-09-02). This wrote the plan when the runner '
    + 'accepted an injury protocol at '
    + 'POST /api/coach/proposal/[id]/accept. All three of its reachability conditions are now gone: '
    + 'the writer (adapt.ts\'s detectInjuryActive), the acceptor (that route\'s injury_adjust limb), '
    + 'and execution — `buildInjuryPlan` returns a refusal as its first statement, before any '
    + 'database read, so this body cannot be entered. Kept because four live INJURY.* doctrine '
    + 'claims bind constants in this module against Research/05; see MODULE_ORPHANS in '
    + 'lib/audit/generated-content-registry.ts for the full argument, and '
    + 'lib/plan/_injury_mode_sealed.test.ts for the three guards that hold it shut. It stays '
    + 'DECLARED rather than dropped because sealed is not deleted: if the seal is ever opened this '
    + 'statement writes a plan again, and it must not do so unlisted.',
  'lib/race/race-role-apply.ts::applyRaceRole':
    'runner-initiated: reached only from POST /api/plan/proposal accept on a race_role card · the '
    + 'runner accepting the coach\'s tune-up recommendation (RACEROLE-1, 2026-08-28). The nightly '
    + 'cron writes ONLY the pending plan_proposals card (declared under cron/plan-drift); the race '
    + 'row\'s meta.plannedRole and the plan_workouts week patch move only on the runner\'s accept, '
    + 'and the patch runs through mutatePlan.',
  'lib/plan/replan-scenarios.ts::applyChange':
    'runner-initiated: reached from POST /api/plan/change and POST /api/plan/replan, both runner '
    + 'actions. lib/plan/v5-block.ts also imports it but calls only proposeChange and the read-only '
    + 'gates, never applyChange.',
  'lib/plan/reschedule.ts::writeEdits':
    'runner-initiated: reached ONLY from applyReschedule and undoReschedule in the same file, and '
    + 'both of those only from POST /api/plan/reschedule, which requires an option id AND the '
    + 'proposal token the runner actually read (a stale token is a 409). No cron imports '
    + 'lib/plan/reschedule.ts; _reschedule_not_adaptation.test.ts walks the import graph in the '
    + 'other direction and fails if this module ever reaches the adaptation seam. Every write goes '
    + 'through mutatePlan, and the recommendation path that precedes it issues nothing but SELECTs '
    + '(asserted against a recording transaction in _reschedule_contract.test.ts).',
};

// ─────────────────────────────────────────────────────────────────────────────

describe('GUARD 0 · the scan opened something', () => {
  it('parsed enough source, cron routes and workflows to mean anything', () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(400);
    expect(cronRouteDirs.length).toBeGreaterThanOrEqual(MUTATION_SCAN_FLOORS.cronRoutes);
    expect(scheduledWorkflows.length).toBeGreaterThanOrEqual(MUTATION_SCAN_FLOORS.scheduledWorkflows);
    expect(AUTOMATIC_MUTATIONS.length).toBeGreaterThanOrEqual(MUTATION_SCAN_FLOORS.entries);
    expect(PLAN_WRITER_FILES.length).toBeGreaterThan(0);
  });
});

describe('GUARD 1 · the registry holds its shape', () => {
  it('ids are unique and are not line numbers', () => {
    const ids = AUTOMATIC_MUTATIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id, `${id} must be <kind>/<name>`).toMatch(/^(cron|webhook|ingest|readpath)\/[a-z0-9-]+$/);
      expect(id, `${id} must not carry a line number`).not.toMatch(/:\d+/);
    }
  });

  it('every route exists on disk', () => {
    for (const m of AUTOMATIC_MUTATIONS) {
      expect(existsSync(join(WEB, m.route)), `${m.id} → ${m.route} missing`).toBe(true);
    }
  });

  it('every entry answers all five questions with something substantive', () => {
    for (const m of AUTOMATIC_MUTATIONS) {
      expect(m.trigger.length, `${m.id} trigger`).toBeGreaterThan(8);
      expect(m.onPartialFailure.length, `${m.id} onPartialFailure`).toBeGreaterThan(20);
      expect(m.reversible.length, `${m.id} reversible`).toBeGreaterThan(8);
    }
  });

  it('anything non-idempotent, invisible, or destructive carries an argued note', () => {
    const needsArgument = (m: AutomaticMutation) =>
      !m.idempotent || m.runnerSees === 'invisible'
      || m.reach === 'destructive_or_external' || m.reach === 'replaces_plan';
    for (const m of AUTOMATIC_MUTATIONS.filter(needsArgument)) {
      expect(
        (m.note ?? '').length,
        `${m.id} is non-idempotent, invisible, destructive or replaces the plan. `
        + 'Say what that costs, or fix it.',
      ).toBeGreaterThan(40);
    }
  });

  it('a writer that replaces the plan names training_plans among what it changes', () => {
    for (const m of AUTOMATIC_MUTATIONS.filter((x) => x.reach === 'replaces_plan')) {
      expect(m.changes, `${m.id}`).toContain('training_plans');
    }
  });
});

describe('GUARD 2 · every cron route is declared', () => {
  it('has an entry for each directory under app/api/cron', () => {
    const declared = new Set(
      AUTOMATIC_MUTATIONS.filter((m) => m.id.startsWith('cron/')).map((m) => m.id.slice(5)),
    );
    const undeclared = cronRouteDirs.filter((d) => !declared.has(d));
    expect(
      undeclared,
      'A cron route exists that nothing in the registry describes. Add an entry answering '
      + 'the five questions. Adding a scheduled writer without saying what it can change is '
      + 'how 2026-08-25 happened.',
    ).toEqual([]);
  });

  it('has no entry pointing at a cron route that no longer exists', () => {
    const dirs = new Set(cronRouteDirs);
    const stale = AUTOMATIC_MUTATIONS
      .filter((m) => m.id.startsWith('cron/'))
      .map((m) => m.id.slice(5))
      .filter((n) => !dirs.has(n));
    expect(stale, 'Registry entry outlived its route. Delete it.').toEqual([]);
  });
});

describe('GUARD 3 · every scheduled workflow is accounted for', () => {
  it('is either a registered mutation or an explicitly argued non-mutator', () => {
    const excused = new Set(SCHEDULED_NON_MUTATORS.map((x) => x.workflow));
    const registeredCron = new Set(
      AUTOMATIC_MUTATIONS.filter((m) => m.id.startsWith('cron/')).map((m) => `${m.id.slice(5)}.yml`),
    );
    const orphans = scheduledWorkflows.filter((w) => !excused.has(w) && !registeredCron.has(w));
    expect(
      orphans,
      'A workflow runs on a schedule and nothing says what it does to a runner. Register it, '
      + 'or add it to SCHEDULED_NON_MUTATORS with the reason it changes nothing.',
    ).toEqual([]);
  });

  it('every excuse is an argument, not a shrug', () => {
    for (const x of SCHEDULED_NON_MUTATORS) {
      expect(x.reason.length, `${x.workflow}`).toBeGreaterThan(60);
    }
  });
});

describe('GUARD 4 · the plan writers in the source are the plan writers on the list', () => {
  it('every plan-writing STATEMENT maps to a declared plan writer', () => {
    const declaredIds = new Set(planWriters().map((m) => m.id));
    const unmapped = PLAN_WRITE_SITES
      .filter((s) => !PLAN_WRITER_SITE_OWNERS[s.id])
      .map((s) => `${s.id}  [${s.kind}]  ${s.file}:${s.line}`);
    expect(
      [...new Set(unmapped)],
      'A statement writes the training plan from a non-runner-initiated path and no registry entry '
      + 'claims it. This is the exact shape of snapshot-projections, which rewrote every future '
      + 'prescribed pace daily while the incident inventory listed two plan writers.\n\n'
      + 'The unit here is the FUNCTION, not the file: adding a second writer inside an '
      + 'already-declared file used to pass, and it inherited that file\'s answers to the '
      + 'registry\'s five questions while they were no longer true of it. Either map this site to '
      + 'an existing entry or add one.',
    ).toEqual([]);

    for (const [site, owner] of Object.entries(PLAN_WRITER_SITE_OWNERS)) {
      if (owner.startsWith('runner-initiated:')) {
        // An exclusion has to be an argument. "It's fine" is not one.
        expect(
          owner.length,
          `${site} is excluded as runner-initiated with no real reason. Name the route that reaches it.`,
        ).toBeGreaterThan(80);
        continue;
      }
      expect(declaredIds.has(owner), `${site} claims owner ${owner}, which is not a plan writer`).toBe(true);
    }
  });

  it('every test-only exclusion still exists and still carries its fence', () => {
    // Rule 18 guard 4 · the allowlist is a ratchet. A file that has been
    // deleted, or that has lost the fence the exclusion rests on, fails until
    // the entry is deleted — the exclusion cannot outlive its own argument.
    for (const f of TEST_ONLY_FENCED) {
      const abs = join(WEB, f);
      expect(existsSync(abs), `${f} is excluded here and no longer exists. Delete the entry.`).toBe(true);
      const src = readFileSync(abs, 'utf8');
      expect(
        /assertHarnessDatabase\s*\(\s*\)/.test(src),
        `${f} is excluded as fenced test-only code but no longer calls assertHarnessDatabase() at module scope. `
        + 'Either restore the fence or map the file to a real plan writer.',
      ).toBe(true);
    }
  });

  it('every mapping points at a statement that still writes a plan', () => {
    const found = new Set(PLAN_WRITE_SITE_IDS);
    const stale = Object.keys(PLAN_WRITER_SITE_OWNERS).filter((s) => !found.has(s));
    expect(
      stale,
      'Mapping outlived the call site. Delete it. (A renamed function counts: the id is '
      + '<file>::<enclosingFunction>, so a rename retires the old entry and needs a new one.)',
    ).toEqual([]);
  });

  it('holds the plan-writer floor', () => {
    expect(planWriters().length).toBeGreaterThanOrEqual(MUTATION_SCAN_FLOORS.planWriters);
  });
});

/**
 * GUARD 6 · "surfaced" means surfaced ON THE PHONE TOO.
 *
 * The failure this exists for, exactly:
 *
 *   · `plan_proposals` rows have rendered on the web since 2026-06-02 — a card
 *     saying what changed, with a link to the diff.
 *   · The phone had no reader. TodayView carried a comment explaining why:
 *     "/api/plan/proposal is POST-only ... Adding them needs a server-side GET."
 *   · That GET was added on 2026-08-17. The comment was never revisited.
 *   · On 2026-08-25 the drift cron replaced the owner's block. The web had the
 *     card. The phone, which is the surface he uses daily, had nothing.
 *
 * So "does the runner see it" was TRUE and FALSE at the same time, and the true
 * half is the one everyone quoted. A visibility claim that holds on one surface
 * is not a visibility claim.
 *
 * The check is deliberately crude — does any Swift file mention the endpoint —
 * because the failure it catches is crude: nobody called it at all.
 */
describe('GUARD 6 · a surfaced change reaches the phone, not just the web', () => {
  const NATIVE = resolve(ROOT, 'native-v2');

  /** Every .swift file under native-v2, concatenated once. */
  function nativeSource(): string {
    const files: string[] = [];
    const walkSwift = (dir: string) => {
      if (!existsSync(dir)) return;
      for (const name of readdirSync(dir)) {
        // Xcode build output can hold entries stat() rejects on this volume, and holds no source.
        if (name.startsWith('.') || name === 'build' || name === 'DerivedData') continue;
        const p = join(dir, name);
        let stat;
        try {
          stat = statSync(p);
        } catch {
          continue;
        }
        if (stat.isDirectory()) walkSwift(p);
        else if (name.endsWith('.swift')) files.push(p);
      }
    };
    walkSwift(NATIVE);
    return files.map((f) => readFileSync(f, 'utf8')).join('\n');
  }

  /**
   * The endpoint each surfaced mutation is read through, and the phone is
   * expected to call. Only listed where a phone reader is the right answer.
   */
  const SURFACE_ENDPOINTS: Record<string, string> = {
    'cron/plan-drift': 'api/plan/proposal',
    'cron/run-adaptations': 'api/plan/workout-proposals',
    // REANCHORPROPOSES-1 (2026-09-05) · the daily self-heal stopped writing
    // the plan and started raising a card on the same table. Its entry flipped
    // from `audit_row_only` to `surfaced`, and this is the claim that has to
    // hold for that word to mean anything: the runner's paces now move only
    // when he taps, so a card he cannot see is a pace axis that has gone
    // silent.
    'cron/snapshot-projections': 'api/plan/workout-proposals',
  };

  it('opened the native tree', () => {
    expect(existsSync(NATIVE), 'native-v2 missing · this guard cannot report clean on nothing').toBe(true);
    expect(nativeSource().length).toBeGreaterThan(100_000);
  });

  it('every surfaced mutation with a named endpoint has a native reader', () => {
    const src = nativeSource();
    const missing: string[] = [];
    for (const [id, endpoint] of Object.entries(SURFACE_ENDPOINTS)) {
      const entry = AUTOMATIC_MUTATIONS.find((m) => m.id === id);
      if (!entry || entry.runnerSees !== 'surfaced') continue;
      if (!src.includes(endpoint)) missing.push(`${id} → ${endpoint}`);
    }
    expect(
      missing,
      'The registry says the runner sees this and the phone never calls the endpoint that '
      + 'would show it. That is how a cron replaced a training block overnight with a card on '
      + 'the web and nothing on the surface the runner actually opens.',
    ).toEqual([]);
  });

  it('the native reader is a real call, not a comment about one', () => {
    const src = nativeSource();
    // The 2026-08-25 state precisely: the only mention of the endpoint anywhere
    // in native-v2 was inside a comment explaining that it could not be called.
    // A guard that greps for the string alone would have passed on that.
    const code = stripComments(src);
    expect(
      code.includes('api/plan/proposal'),
      'api/plan/proposal appears in native-v2 only inside comments. A comment is not a reader.',
    ).toBe(true);
  });
});

describe('GUARD 5 · the planted defect', () => {
  /**
   * The gate must be able to FAIL. A coverage test that passes on a codebase it
   * never opened is the same failure as a swallowed catch: the absence of a
   * signal read as an all-clear.
   *
   * Two plants. The first is a file that writes the plan and appears on no
   * list — literally the snapshot-projections shape. The second is the comment
   * stripper, because if it stopped working every file that merely MENTIONS
   * generatePlan would register as a writer and guard 4 would drown in false
   * positives until someone loosened it.
   */
  it('catches a plan writer in a NEW FILE that declares itself nowhere', () => {
    // Driven off a FIXTURE list of already-owned ids, not off the live scan:
    // a control that mixes in the real tree stops isolating the predicate the
    // moment the tree has a genuine finding, and then reports the plant as
    // wrong when it is the tree that changed.
    const owned = Object.keys(PLAN_WRITER_SITE_OWNERS);
    const planted = [...owned, 'lib/plan/a-quiet-new-rebuilder.ts::rebuild'];
    const unmapped = planted.filter((s) => !PLAN_WRITER_SITE_OWNERS[s]);
    expect(unmapped).toEqual(['lib/plan/a-quiet-new-rebuilder.ts::rebuild']);
  });

  /**
   * THE PLANT THAT USED TO PASS. Before 2026-09-01 the unit was the FILE, and
   * appending this statement to `lib/plan/reanchor-plan.ts` — already declared
   * under cron/snapshot-projections — was invisible: "ok · 23 entries",
   * "Tests 20 passed". Falsified against the real file, restored, and pinned
   * here as a fixture so the fix cannot silently regress.
   */
  it('catches a SECOND writer inside an already-declared file', () => {
    const src = `
      import { pool } from '@/lib/db/pool';
      export async function reanchorMaintenance(planId: string) {
        await pool.query(\`UPDATE plan_workouts SET pace_target_s_per_mi = $1\`, [1]);
      }
      export async function quietlyRewritePaces(planId: string) {
        await pool.query(
          \`UPDATE plan_workouts SET pace_target_s_per_mi = 600 WHERE plan_id = $1\`,
          [planId],
        );
      }
    `;
    const sites = scanPlanWriteSitesIn('lib/plan/reanchor-plan.ts', src);
    const ids = [...new Set(sites.map((s) => s.id))].sort();
    // Both are seen, and they are DIFFERENT ids — which is the whole fix.
    expect(ids).toEqual([
      'lib/plan/reanchor-plan.ts::quietlyRewritePaces',
      'lib/plan/reanchor-plan.ts::reanchorMaintenance',
    ]);
    // The declared one is owned; the new one is not, so the gate fires.
    expect(ids.filter((i) => !PLAN_WRITER_SITE_OWNERS[i]))
      .toEqual(['lib/plan/reanchor-plan.ts::quietlyRewritePaces']);
  });

  it('does not count SQL that only appears in a comment', () => {
    const src = `
      // This function used to run UPDATE plan_workouts SET x = 1. It no longer does.
      /* DELETE FROM plan_workouts is discussed in the doc below. */
      export function nothingHappensHere() { return 1; }
    `;
    expect(scanPlanWriteSitesIn('lib/plan/prose.ts', src)).toEqual([]);
  });

  it('does count multi-line SQL, which is how this codebase writes it', () => {
    const src = `
      export async function movesADay() {
        await pool.query(\`
          UPDATE
            plan_workouts
             SET date_iso = $1\`, [1]);
      }
    `;
    const sites = scanPlanWriteSitesIn('lib/plan/x.ts', src);
    expect(sites.map((s) => s.id)).toEqual(['lib/plan/x.ts::movesADay']);
    expect(sites[0].kind).toBe('UPDATE');
  });

  it('does not count a call site that only appears in a comment', () => {
    const proseOnly = `
      /* This module used to call generatePlan( directly. It no longer does. */
      // reanchorActivePlan( is discussed in the doc below.
      export const NOTHING = 1;
    `;
    const code = proseOnly.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(/\bgeneratePlan\s*\(/.test(code)).toBe(false);
    expect(/\breanchorActivePlan\s*\(/.test(code)).toBe(false);
  });

  it('does count a real call site', () => {
    const real = `import { generatePlan } from '@/lib/plan/generate';\nawait generatePlan({ userId });`;
    const code = real.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(/\bgeneratePlan\s*\(/.test(code)).toBe(true);
  });
});
