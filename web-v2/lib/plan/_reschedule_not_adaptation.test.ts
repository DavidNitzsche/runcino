/**
 * lib/plan/_reschedule_not_adaptation.test.ts · the separation, enforced.
 *
 * "Rescheduling is not adaptation. Adaptation changes training because
 *  demonstrated capacity changed. Rescheduling changes placement because the
 *  runner supplied a constraint. Separate typed decisions, owners, records and
 *  mutation paths."
 *
 * A purely behavioural test cannot prove this. It can only prove adaptation did
 * not fire on the cases the test happened to run, and Rule 22's whole point is
 * that those cases carry the bias of whoever wrote them. So this is static.
 *
 * ─── WHY IT IS NOT A NAIVE TRANSITIVE WALK, AND WHAT WAS LEARNED ────────────
 *
 * The first version walked the full transitive import graph and failed
 * immediately with six hits. Every one of them was real reachability and none
 * of them was a rescheduling defect:
 *
 *     reschedule.ts -> mutate.ts -> generate.ts
 *     reschedule.ts -> replan-scenarios.ts -> drift-proposal-policy.ts -> auto-rebuild.ts
 *     reschedule.ts -> dosing.ts -> prescription/levers.ts -> adaptation/adaptation-model.ts
 *
 * `mutate.ts` is THE plan mutation boundary and imports `generate.ts` for the
 * validator; `dosing.ts` is the doctrine table every plan surface prices
 * against. `lib/plan` is one connected component, so full transitive
 * reachability is not a usable signal here: it would be red for every file in
 * the directory, which means it would be ignored, which means it would stop
 * meaning anything (Rule 18's stale-gate failure mode, arrived at on day one).
 *
 * What IS a usable signal is the edge this module OWNS. The walk expands
 * everything except a small, argued set of shared-infrastructure STOP NODES,
 * so a new import from the rescheduling surface to anything adaptation-shaped
 * fails, and so does a new import added to a helper that is not shared
 * infrastructure. The stop list is a ratchet: it may shrink, never grow, and
 * each entry carries its reason.
 *
 * The runtime half is covered separately and independently, by
 * `_reschedule_contract.test.ts`, which drives a real apply against a recording
 * transaction and asserts which tables were actually written.
 *
 * ─── WHAT THIS TEST CANNOT FAIL ON  (Rule 22) ───────────────────────────────
 *
 * · Anything reached THROUGH a stop node. That is the deliberate trade above,
 *   and it is why the runtime table assertions exist.
 * · A call made through a string-built specifier, a registry lookup, or an HTTP
 *   round trip to another route. Nothing in these files does that today.
 * · Adaptation reaching INTO rescheduling. The forbidden direction here is
 *   reschedule -> adapt; the reverse would be a different arrangement and a
 *   legitimate one.
 * · Whether the rescheduling logic is CORRECT. It proves only that it is its
 *   own.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');

/** The entry points that make up the rescheduling surface. */
const ENTRIES = [
  'lib/plan/reschedule.ts',
  'app/api/plan/reschedule/route.ts',
];

/**
 * Shared infrastructure the walk does not expand through. RATCHET: may shrink,
 * never grow. Each entry says why it is shared rather than rescheduling's own.
 */
const STOP_NODES: Record<string, string> = {
  'lib/plan/mutate.ts':
    'THE plan mutation boundary. Every plan writer in the app goes through it, '
    + 'and it imports generate.ts for the validator. Using it is the correct '
    + 'behaviour, not a leak.',
  'lib/plan/replan-scenarios.ts':
    'Owns loadPlanShape, the one reader of the live plan shape. Reusing it is '
    + 'what stops rescheduling becoming a second reader of the same rows.',
  'lib/plan/dosing.ts':
    'The Daniels dosing table. Every surface that prices a week reads it.',
  'lib/plan/seal.ts':
    'Rule 15, completed days are immutable. A safety guard shared by every writer.',
  'lib/db/pool.ts': 'The connection pool.',
  'lib/auth/session.ts': 'Route auth.',
  'lib/runtime/runner-tz.ts': 'The runner-local date. Never a clock.',
};

/**
 * Modules that own adaptation, progression, pace re-anchoring, plan rebuilding
 * or a fitness belief. Reaching any of them from the rescheduling surface means
 * a reschedule could change TRAINING, which is the one thing it may not do.
 */
const FORBIDDEN = [
  'lib/plan/adapt.ts',
  'lib/plan/adaptive-ramp.ts',
  'lib/plan/progression-pass.ts',
  'lib/plan/auto-rebuild.ts',
  'lib/plan/recompute-paces.ts',
  'lib/plan/drift-monitor.ts',
  'lib/plan/generate.ts',
  'lib/training/lthr-reanchor.ts',
  'lib/training/fitness-trajectory.ts',
];

const FORBIDDEN_DIRS = ['lib/adaptation/', 'lib/adaptation-harness/'];

/**
 * Entry points of the adaptation seam, by name. A reference to any of these in
 * the rescheduling source is a call into the other engine even if the import
 * were somehow laundered.
 */
const FORBIDDEN_SYMBOLS = [
  'runAdaptations', 'tryAdaptiveBump', 'fireAutoRebuild', 'reanchorLthr',
  'recomputePaces', 'runProgressionPass', 'generatePlan',
  'detectMissedKeyWorkout', 'chooseRescheduleDate', 'buildGapActions',
];

function resolveSpecifier(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(path.join(ROOT, fromFile)), spec);
  else return null;                                  // node_modules · not ours
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return path.relative(ROOT, cand);
  }
  return null;
}

/** Static `from '…'`, dynamic `import('…')` and `require('…')`. All are edges. */
function specifiersIn(src: string): string[] {
  const out: string[] = [];
  for (const re of [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) out.push(m[1]);
  }
  return out;
}

interface Walk { visited: Set<string>; trail: Map<string, string[]>; edges: number }

function walk(): Walk {
  const visited = new Set<string>();
  const trail = new Map<string, string[]>();
  let edges = 0;
  const queue = ENTRIES.map((f) => ({ file: f, path: [f] }));
  while (queue.length) {
    const cur = queue.shift()!;
    if (visited.has(cur.file)) continue;
    visited.add(cur.file);
    trail.set(cur.file, cur.path);
    if (cur.file in STOP_NODES) continue;            // shared infrastructure
    const abs = path.join(ROOT, cur.file);
    if (!fs.existsSync(abs)) continue;
    for (const spec of specifiersIn(fs.readFileSync(abs, 'utf8'))) {
      const next = resolveSpecifier(spec, cur.file);
      if (!next) continue;
      edges++;
      if (!visited.has(next)) queue.push({ file: next, path: [...cur.path, next] });
    }
  }
  return { visited, trail, edges };
}

describe('rescheduling cannot reach the adaptation engine', () => {
  it('every entry point exists', () => {
    for (const e of ENTRIES) expect(fs.existsSync(path.join(ROOT, e)), `${e} is missing`).toBe(true);
  });

  it('the walk actually parsed edges, and reached the boundary it is supposed to use', () => {
    const { visited, edges } = walk();
    // Rule 18 liveness: a scanner that matched nothing must not report clean.
    expect(edges, `the specifier patterns matched ${edges} edges`).toBeGreaterThan(6);
    expect(visited.has('lib/plan/mutate.ts'), 'reschedule no longer uses the mutation boundary').toBe(true);
    expect(visited.has('lib/plan/seal.ts'), 'reschedule no longer checks sealed days').toBe(true);
  });

  it('reaches no adaptation, progression, re-anchor or rebuild module', () => {
    const { visited, trail } = walk();
    const hits: string[] = [];
    for (const f of visited) {
      if (FORBIDDEN.includes(f) || FORBIDDEN_DIRS.some((d) => f.startsWith(d))) {
        hits.push(`${f}\n      via ${trail.get(f)!.join('\n        -> ')}`);
      }
    }
    expect(hits, `rescheduling reaches the adaptation seam:\n  ${hits.join('\n  ')}`).toEqual([]);
  });

  it('names no adaptation entry point in its own source', () => {
    for (const e of ENTRIES) {
      const src = fs.readFileSync(path.join(ROOT, e), 'utf8');
      // Strip comments: the header EXPLAINS which modules are excluded, and
      // that explanation must not be what trips the check.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const sym of FORBIDDEN_SYMBOLS) {
        expect(code, `${e} references ${sym}`).not.toContain(sym);
      }
    }
  });

  it('names no adaptation-seam table in its own source', () => {
    for (const e of ENTRIES) {
      const src = fs.readFileSync(path.join(ROOT, e), 'utf8');
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const table of ['coach_intents', 'plan_mutations', 'adaptation_log', 'last_adapted_at', 'day_actions']) {
        expect(code, `${e} names ${table}`).not.toContain(table);
      }
    }
  });

  it('the forbidden list and the stop list both name files that exist', () => {
    // A forbidden entry pointing at a deleted file is a check that cannot fail;
    // a stop node pointing at a deleted file is an exemption gone stale.
    for (const f of FORBIDDEN) {
      expect(fs.existsSync(path.join(ROOT, f)), `forbidden entry ${f} no longer exists`).toBe(true);
    }
    for (const f of Object.keys(STOP_NODES)) {
      expect(fs.existsSync(path.join(ROOT, f)), `stop node ${f} no longer exists`).toBe(true);
    }
  });

  it('every stop node is actually reached · no dead exemptions', () => {
    const { visited } = walk();
    const unused = Object.keys(STOP_NODES).filter((f) => !visited.has(f));
    expect(unused, `stop nodes that nothing reaches, delete them: ${unused.join(', ')}`).toEqual([]);
  });

  it('declares the discriminants that keep the two decisions apart', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/plan/reschedule.ts'), 'utf8');
    expect(src).toContain("export type RescheduleKind = 'RESCHEDULE'");
    expect(src).toContain("export type RescheduleOrigin = 'RUNNER_CONSTRAINT'");
    // The literal type is the enforcement: a decision claiming to move a
    // fitness belief would not compile.
    expect(src).toMatch(/evidenceEffect:\s*'NONE'/);
  });
});
