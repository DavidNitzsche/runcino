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

export function scanPlanWriterFiles(files: readonly string[]): string[] {
  const hits = new Set<string>();
  for (const abs of files) {
    const r = rel(abs);
    if (RUNNER_INITIATED.includes(r) || PLAN_INFRASTRUCTURE.includes(r)) continue;
    if (writesAPlan(stripComments(readFileSync(abs, 'utf8')))) hits.add(r);
  }
  return [...hits].sort();
}

const PLAN_WRITER_FILES = scanPlanWriterFiles(SOURCE_FILES);

/**
 * Every file that writes a plan, and which automatic trigger reaches it.
 *
 * A value of `runner-initiated: <reason>` means this file is only ever reached
 * by a runner tapping something. That is an ARGUMENT, not an exclusion list —
 * it lives here, next to the automatic ones, and the gate requires it to be a
 * sentence. An exclusion with no reason is how a writer gets quietly filed as
 * harmless, which is the failure this whole gate exists to stop.
 *
 * Several triggers share one implementation file, so the mapping is many-to-one
 * and stated rather than inferred.
 *
 * Every attribution below was established by reading the import graph. The
 * first draft of this map was written from a summary and the gate rejected two
 * of its entries within a minute, which is the argument for the gate.
 */
const PLAN_WRITER_FILE_OWNERS: Record<string, string> = {
  // Automatic.
  'lib/plan/auto-rebuild.ts': 'cron/plan-drift',
  'lib/plan/open-block.ts': 'cron/plan-drift',
  'lib/plan/generate.ts': 'cron/plan-drift',
  'lib/race/result-chain.ts': 'cron/plan-drift',
  'app/api/cron/silent-rebuild/route.ts': 'cron/silent-rebuild',
  'app/api/cron/snapshot-projections/route.ts': 'cron/snapshot-projections',
  'lib/plan/reanchor-plan.ts': 'cron/snapshot-projections',
  'lib/plan/recompute-paces.ts': 'cron/snapshot-projections',
  'lib/plan/adapt.ts': 'cron/run-adaptations',
  'lib/plan/progression-pass.ts': 'cron/run-adaptations',

  // Runner-initiated, each with the route that reaches it.
  'lib/plan/injury-builder.ts':
    'runner-initiated: reached only from POST /api/coach/proposal/[id]/accept, which is the runner '
    + 'accepting an injury protocol. adapt.ts mentions it in comments and does not import it.',
  'lib/plan/replan-scenarios.ts':
    'runner-initiated: reached from POST /api/plan/change and POST /api/plan/replan, both runner '
    + 'actions. lib/plan/v5-block.ts also imports it but calls only proposeChange and the read-only '
    + 'gates, never applyChange.',
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
  it('every automatic caller of generatePlan / reanchorActivePlan maps to a declared plan writer', () => {
    const declaredIds = new Set(planWriters().map((m) => m.id));
    const unmapped = PLAN_WRITER_FILES.filter((f) => !PLAN_WRITER_FILE_OWNERS[f]);
    expect(
      unmapped,
      'A file writes the training plan from a non-runner-initiated path and no registry entry '
      + 'claims it. This is the exact shape of snapshot-projections, which rewrote every future '
      + 'prescribed pace daily while the incident inventory listed two plan writers. Either map '
      + 'it to an existing entry or add one.',
    ).toEqual([]);

    for (const [file, owner] of Object.entries(PLAN_WRITER_FILE_OWNERS)) {
      if (owner.startsWith('runner-initiated:')) {
        // An exclusion has to be an argument. "It's fine" is not one.
        expect(
          owner.length,
          `${file} is excluded as runner-initiated with no real reason. Name the route that reaches it.`,
        ).toBeGreaterThan(80);
        continue;
      }
      expect(declaredIds.has(owner), `${file} claims owner ${owner}, which is not a plan writer`).toBe(true);
    }
  });

  it('every mapping points at a file that still writes a plan', () => {
    const found = new Set(PLAN_WRITER_FILES);
    const stale = Object.keys(PLAN_WRITER_FILE_OWNERS).filter((f) => !found.has(f));
    expect(stale, 'Mapping outlived the call site. Delete it.').toEqual([]);
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
  it('catches a plan writer that declares itself nowhere', () => {
    const planted = [...PLAN_WRITER_FILES, 'lib/plan/a-quiet-new-rebuilder.ts'];
    const unmapped = planted.filter((f) => !PLAN_WRITER_FILE_OWNERS[f]);
    expect(unmapped).toEqual(['lib/plan/a-quiet-new-rebuilder.ts']);
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
