/**
 * THE ORCHESTRATION DECLARATION IS CHECKED AGAINST THE SOURCE.
 *
 * A list of sixteen steps with a state beside each is documentation, and this
 * repo has been burned by documentation: `lthr-reanchor.ts` asserted in its own
 * header that it "imports no database at any depth", which was false for a day
 * while production sat undeployed and no check could tell (Rule 19, Rule 20).
 *
 * So every claim here is verified:
 *   · the owning module EXISTS
 *   · it EXPORTS the symbol the step names
 *   · a WIRED step has a real importer outside its own directory
 *   · a step that is not WIRED carries a specific blocker, never a shrug
 *   · the wired count is a RATCHET
 *
 * WHAT THIS CANNOT FAIL ON (Rule 22):
 *   · Whether the step does its job WELL. It checks reachability, not quality.
 *   · Whether the sixteen steps are the right sixteen.
 *   · Whether a WIRED step is reached on the path that MATTERS. An importer is
 *     evidence of reachability, not of being on the nightly coaching path —
 *     which is why `SHADOW` exists as a separate state and is not counted.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildModuleGraph } from '@/lib/audit/module-graph';
import {
  ORCHESTRATION_STEPS, WIRED_STEP_PIN, NOT_BUILT_PIN, wiredCount,
} from './steps';

const ROOT = process.cwd();
const REPO = join(ROOT, '..');

/**
 * The real import graph, including dynamic imports — the same builder the
 * client-graph gate uses. Written by hand first as "is it imported from outside
 * its own directory", which was wrong in both directions: it called
 * `v5-action-render.ts` unreachable because its only importer is its neighbour
 * `v5-proposals.ts`, and it would have called a module WIRED on the strength of
 * one import from another orphan.
 *
 * Reachability from a ROUTE is the question. Anything else is a proxy for it.
 */
const GRAPH = buildModuleGraph(REPO, ['web-v2/lib', 'web-v2/app']);

const isEntryPoint = (f: string): boolean =>
  /web-v2\/app\/.*\/route\.ts$/.test(f) || /web-v2\/app\/.*\/page\.tsx$/.test(f);

const isTestOrScript = (f: string): boolean =>
  f.includes('.test.') || f.includes('.script.') || f.includes('_fixtures');

/** Does any Next.js route or page reach this module, at any depth? */
function reachedFromProduction(rel: string): string | null {
  const target = `web-v2/${rel}`;
  const seen = new Set<string>([target]);
  let frontier = [target];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const f of frontier) {
      for (const importer of GRAPH.importedBy.get(f) ?? []) {
        if (seen.has(importer) || isTestOrScript(importer)) continue;
        if (isEntryPoint(importer)) return importer;
        seen.add(importer);
        next.push(importer);
      }
    }
    frontier = next;
  }
  return null;
}

describe('orchestration · the declaration is true', () => {
  it('read a real corpus', () => {
    // Liveness (Rule 18). This repo has shipped gates that reported clean
    // because they scanned zero files.
    expect(GRAPH.files.length).toBeGreaterThan(500);
    expect(ORCHESTRATION_STEPS.length).toBe(16);
    // And the graph must actually find entry points, or every step would read
    // as unreachable and this file would fail for the wrong reason.
    expect(GRAPH.files.filter(isEntryPoint).length).toBeGreaterThan(20);
  });

  it('every step names a module that exists, or admits it has no owner', () => {
    for (const s of ORCHESTRATION_STEPS) {
      if (s.owner === null) {
        expect(s.state, `step ${s.n} has no owner but is not NOT_BUILT`).toBe('NOT_BUILT');
        continue;
      }
      expect(existsSync(join(ROOT, s.owner)), `step ${s.n} owns a module that is not there: ${s.owner}`)
        .toBe(true);
    }
  });

  it('NOT_BUILT is a ratchet that may only fall', () => {
    const n = ORCHESTRATION_STEPS.filter((s) => s.state === 'NOT_BUILT').length;
    expect(n, `${n} steps do not exist at all, against a pin of ${NOT_BUILT_PIN}. A step `
      + 'becoming fiction again is a regression, and building one means lowering this.')
      .toBeLessThanOrEqual(NOT_BUILT_PIN);
    expect(n, `the NOT_BUILT pin is stale at ${NOT_BUILT_PIN}; ${n} steps are unbuilt.`)
      .toBe(NOT_BUILT_PIN);
  });

  it('every step names a symbol its owner actually exports', () => {
    for (const s of ORCHESTRATION_STEPS) {
      if (s.owner === null || s.ownerExports === null) continue;
      const src = readFileSync(join(ROOT, s.owner), 'utf8');
      const exported = new RegExp(
        `export\\s+(?:async\\s+)?(?:function|const|class|type|interface|let)\\s+${s.ownerExports}\\b`,
      ).test(src);
      expect(exported, `step ${s.n} (${s.name}) claims ${s.owner} exports ${s.ownerExports}, and it does not`)
        .toBe(true);
    }
  });

  it('a WIRED step is reachable from a route, at any depth', () => {
    for (const s of ORCHESTRATION_STEPS) {
      if (s.state !== 'WIRED' || s.owner === null) continue;
      const via = reachedFromProduction(s.owner);
      expect(via,
        `step ${s.n} (${s.name}) is declared WIRED and NO route reaches ${s.owner} at any `
        + 'depth. Declared-and-unreachable is the exact shape this file exists to catch.')
        .not.toBeNull();
    }
  });

  it('a SHADOW or UNWIRED step is NOT quietly reachable', () => {
    // The other direction, and the one a ratchet needs: if a step became
    // reachable, the declaration is stale and someone should raise the pin
    // rather than leave the map lying about the system.
    for (const s of ORCHESTRATION_STEPS) {
      if (s.state !== 'UNWIRED' || s.owner === null) continue;
      const via = reachedFromProduction(s.owner);
      expect(via,
        `step ${s.n} (${s.name}) is declared UNWIRED but ${via} reaches ${s.owner}. `
        + 'Either it got wired — raise the pin and say so — or the blocker is wrong.')
        .toBeNull();
    }
  });

  it('a step that is not WIRED says specifically what is missing', () => {
    for (const s of ORCHESTRATION_STEPS) {
      if (s.state === 'WIRED') continue;
      expect(s.blocker, `step ${s.n} is ${s.state} with no blocker recorded`).toBeTruthy();
      expect((s.blocker ?? '').length,
        `step ${s.n}'s blocker is too short to be an argument`).toBeGreaterThan(40);
      expect(s.blocker, `step ${s.n}'s blocker is a shrug`).not.toMatch(/\bTODO\b|later|for now/i);
    }
  });

  it('the wired count is a ratchet that may only rise', () => {
    const n = wiredCount();
    expect(n,
      `${n} steps are WIRED against a pin of ${WIRED_STEP_PIN}. If you WIRED one, raise the `
      + 'pin in the same change. If this fell, a step regressed and the plan lost a link.')
      .toBeGreaterThanOrEqual(WIRED_STEP_PIN);
    expect(n, `the pin is stale at ${WIRED_STEP_PIN}; ${n} steps are wired. Raise it.`)
      .toBe(WIRED_STEP_PIN);
  });
});
