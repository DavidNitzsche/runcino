/**
 * INJURY-SEALED-1 · the app does not put the runner on a walk-run plan.
 *
 * ── THE RULING ─────────────────────────────────────────────────────────────
 *
 * `docs/PLAN_SIMPLIFICATION_DOCTRINE.md` (locked 2026-09-02) lists `injury`
 * and `automatic return-to-training ladders` among the levers whose decision
 * authority is removed — "not hidden, not defaulted off, removed" — and the
 * owner's words on the feature were "its noise. its a feature we can add in
 * later."
 *
 * `buildInjuryPlan` ARCHIVES the runner's active marathon block and writes a
 * different plan in its place. It is the single largest mutation in the
 * codebase and it used to fire off a `runner_injuries` row the runner typed in
 * himself. Three independent things now stop it, and this file asserts all
 * three, because any one of them alone would be a single point of failure.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ────────────────────────────────
 *
 *   · IT READS SOURCE TEXT for the writer and acceptor checks. A proposal of
 *     type `injury_adjust` inserted by hand, by a migration, or by a string
 *     assembled at run time is invisible to it — which is exactly why the
 *     THIRD check calls the real function and asserts it refuses, rather than
 *     trusting the absence of callers.
 *   · IT SAYS NOTHING ABOUT THE LADDER'S CORRECTNESS. Whether the walk-run
 *     stages still match `Research/05` is `INJURY.walk-run-ladder-is-encoded-
 *     verbatim`'s job, and those claims are deliberately still live.
 *   · IT CANNOT TELL A DELIBERATE RETURN FROM AN ACCIDENTAL ONE. When the
 *     feature comes back with a runner-initiated entry point, this file must
 *     be rewritten by whoever does it. That is the intended cost.
 *   · IT IS ONE-DIRECTIONAL. It can only catch the mode coming back. It has no
 *     opinion on whether the runner has any way to handle an injury at all,
 *     which is a real gap and a product question, not a test's to answer.
 *
 * ── WHY THERE IS NO FLAG TO ASSERT ─────────────────────────────────────────
 *
 * An earlier version of this seal exported `INJURY_RETURN_MODE: false` and
 * guard 3 asserted it. `_seal_single_seam.test.ts` rejected that — the owner
 * asked for exactly ONE default-off adaptation boundary, and a second dormant
 * switch guarding a second plan writer is the state he is removing. The
 * refusal is now a hardcoded return, so this file asserts the BEHAVIOUR
 * instead of a constant, which is the stronger check anyway.
 *
 * ── FALSIFIED (Rule 18) ────────────────────────────────────────────────────
 *
 * Making `buildInjuryPlan` delegate to its retained body fails guard 3 with
 * "buildInjuryPlan did not refuse". Re-adding an `injury_adjust` limb to the
 * accept route fails guard 2. Observed output is in the session report.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildInjuryPlan } from './injury-builder';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Source with comments stripped · the obituaries must be free to name it. */
const code = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('INJURY-SEALED-1 · the app does not put the runner on a walk-run plan', () => {
  it('guard 0 · LIVENESS · the files this gate polices exist and were read', () => {
    for (const rel of [
      'lib/plan/injury-builder.ts',
      'lib/plan/adapt.ts',
      'app/api/coach/proposal/[id]/accept/route.ts',
    ]) {
      expect(fs.existsSync(path.join(ROOT, rel)), `${rel} is missing`).toBe(true);
      expect(read(rel).length, `${rel} is empty`).toBeGreaterThan(100);
    }
  });

  it('guard 1 · NO WRITER · nothing produces an injury_adjust proposal', () => {
    const adapt = code(read('lib/plan/adapt.ts'));
    expect(adapt.includes('detectInjuryActive')).toBe(false);
    expect(adapt.includes("'injury_adjust'")).toBe(false);
    expect(adapt.includes("'injury_active'")).toBe(false);
  });

  it('guard 2 · NO ACCEPTOR · the accept route has no injury_adjust limb', () => {
    const route = code(read('app/api/coach/proposal/[id]/accept/route.ts'));
    expect(
      route.includes("'injury_adjust'"),
      'the accept route can build an injury plan again. That limb archives the '
      + "runner's marathon block.",
    ).toBe(false);
    expect(route.includes('buildInjuryPlan')).toBe(false);
  });

  it('guard 3 · NO EXECUTION · buildInjuryPlan refuses when actually called', async () => {
    // The load-bearing check. Unlike the source scans above it CALLS the
    // function, so a caller the scanners cannot see still cannot archive a
    // block.
    const r = await buildInjuryPlan({ userId: 'no-such-user', injuryId: 1 });
    expect(r.ok, 'buildInjuryPlan did not refuse').toBe(false);
    expect(r.reason, 'the refusal must say why, not fail silently').toBeTruthy();
    expect(String(r.reason)).toMatch(/injury-return mode is not available/);
  });

  it('guard 4 · the refusal comes FIRST, before any database read', () => {
    const src = read('lib/plan/injury-builder.ts');
    const fn = src.indexOf('export async function buildInjuryPlan');
    const refusal = src.indexOf('injury-return mode is not available', fn);
    const firstQuery = src.indexOf('pool.query', fn);
    expect(fn).toBeGreaterThan(-1);
    expect(refusal).toBeGreaterThan(fn);
    expect(
      refusal,
      'the seal no longer precedes the first query · a refused build must not '
      + 'touch the database on its way to saying no',
    ).toBeLessThan(firstQuery);
  });

  it('guard 4b · there is no boolean flag guarding the refusal · ONE seam only', () => {
    // `_seal_single_seam.test.ts` owns the general rule; this asserts the
    // specific shape it rejected, so the flag cannot come back locally and
    // then be argued into that gate's exemption list.
    const src = code(read('lib/plan/injury-builder.ts'));
    expect(
      /export const INJURY_RETURN_MODE/.test(src),
      'the refusal is guarded by a second default-off switch again. The owner '
      + 'asked for exactly one adaptation boundary; this is a plan writer, so '
      + 'it cannot honestly claim it never gates a plan mutation.',
    ).toBe(false);
  });

  it('guard 5 · the doctrine claims that justify keeping the file are still live', () => {
    // Rule 20: the banner claims four INJURY.* claims are why this code stays.
    // If they were retired, the argument for keeping it collapses and the file
    // should be deleted rather than sealed.
    const registry = read('lib/doctrine/registry.ts');
    for (const id of [
      'INJURY.walk-run-ladder-is-encoded-verbatim',
      'INJURY.walk-run-is-priced-at-the-runners-own-easy-pace',
      'INJURY.walk-run-cadence-is-derived-from-the-ladder',
      'INJURY.bsi-return-is-the-doc-band-and-clinician-gated',
    ]) {
      expect(
        registry.includes(id),
        `${id} is gone. injury-builder.ts is kept BECAUSE these claims bind it; `
        + 'with them retired, delete the module instead of sealing it.',
      ).toBe(true);
    }
  });
});
