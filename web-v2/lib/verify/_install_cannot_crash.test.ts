/**
 * INSTALL-SAFETY-1 (2026-09-03) · a safety mechanism may not take the app down.
 *
 * ── THE INCIDENT THIS EXISTS FOR ────────────────────────────────────────────
 *
 * The production write barrier landed and `main` stopped deploying. Three
 * commits failed in a row while `build-check` was green and `verify-commit`
 * reported CLEAN, because the failure was at RUNTIME: Railway restarts on
 * failure five times and then marks the deploy failed.
 *
 * `lib/db/pool.ts` imports `install-barrier.ts` FOR EFFECT, so the install runs
 * at module load in every process that touches the database — including the
 * production server, where it correctly declines to patch anything. But
 * declining to patch is not the same as being unable to THROW: it classifies
 * the process and parses `DATABASE_URL` before it decides, and a throw there
 * fails the import of `pool.ts`, which every API route depends on.
 *
 * Wrapping the call fixed it and the deploy recovered at `18842d09`. That is the
 * evidence; this gate is what stops it coming back.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ──────────────────────────────────────
 *
 *   · Any OTHER module-scope side effect in the server import graph. It checks
 *     this one file, because this one file is the one that caused an outage.
 *     A general "no unguarded top-level work anywhere" check is the right idea
 *     and is not what this is.
 *   · A wrapper that catches and then rethrows, or that catches and leaves the
 *     module in a broken state. It asserts the shape, not the semantics.
 *   · Whether the barrier still WORKS — `_production_write_barrier.test.ts`
 *     owns that, and `vitest.setup.ts` asserts it actually armed.
 *   · Whether the deploy succeeds. Only a deploy can answer that (Rule 19).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(process.cwd(), 'lib/verify/install-barrier.ts');

describe('INSTALL-SAFETY-1 · the barrier install cannot crash an importer', () => {
  const src = fs.readFileSync(SRC, 'utf8');

  it('LIVENESS · the file was read and still performs a module-scope install', () => {
    expect(src.length, 'install-barrier.ts is empty or unreadable').toBeGreaterThan(200);
    expect(src, 'no module-scope install left to guard — has this moved?')
      .toMatch(/export const barrierInstall/);
  });

  it('the module-scope install is wrapped so an importer cannot inherit a throw', () => {
    const decl = src.slice(src.indexOf('export const barrierInstall'));
    expect(
      decl,
      'The install runs at module load in the production server via lib/db/pool.ts. '
      + 'Unwrapped, a throw here fails the import of pool.ts and every API route with '
      + 'it — which took main out of deployment for three commits on 2026-09-03. '
      + 'Keep the try/catch, and keep the failure loud in vitest.setup.ts instead.',
    ).toMatch(/try\s*\{/);
    expect(decl, 'the wrapper must actually handle the throw, not just open a block')
      .toMatch(/catch\s*\(/);
  });

  it('a failed install still returns a result rather than undefined', () => {
    const decl = src.slice(src.indexOf('export const barrierInstall'));
    const c = decl.indexOf('catch');
    expect(decl.slice(c), 'the catch branch must return an InstallResult saying it did not install')
      .toMatch(/installed:\s*false/);
  });
});
