/**
 * lib/verify/install-barrier.ts · the one file that touches `pg` to arm the
 * barrier. Import it for effect; it decides for itself whether to do anything.
 *
 * WHY IT IS SEPARATE FROM `production-barrier.ts`. That module is pure — no
 * `pg`, no database, no Node built-ins — so `middleware.ts` (edge runtime) and
 * `scripts/check-write-barrier.sh` can both use its decision without dragging
 * a database driver behind them. `scripts/check-client-graph.sh` walks every
 * `'use client'` entry looking for exactly that kind of edge, and Rule 19 was
 * earned by a module three hops deep that pulled `pg` into the browser graph
 * and kept production undeployed for a day. Keeping the pure half pure is not
 * tidiness.
 *
 * TWO INSTALL POINTS, ONE IMPLEMENTATION:
 *
 *   · `vitest.setup.ts` — runs in EVERY test process before any test module is
 *     evaluated, so the prototype patch is in place before a test can construct
 *     its own `new Pool(...)`. This is the point that matters: it fences the 78
 *     test files that reach a pool, not just the ones that use the app's.
 *   · `lib/db/pool.ts` — covers a verification process that imports the app's
 *     pool without going through vitest (a `scripts/*.ts` run under tsx with
 *     `FAFF_VERIFICATION=1`).
 *
 * Installing twice is a no-op: `installProductionWriteBarrier` guards on a
 * global symbol.
 */
import * as pg from 'pg';
import { installProductionWriteBarrier, type InstallResult } from './production-barrier';

/**
 * FAIL-SAFE AT IMPORT, FAIL-LOUD IN VERIFICATION (2026-09-03).
 *
 * `lib/db/pool.ts` imports this for effect, so this expression runs at module
 * load in EVERY process that touches the database — including the production
 * server, where `installProductionWriteBarrier` correctly declines to patch
 * anything. But "declines to patch" is not the same as "cannot throw": the
 * install classifies the process and parses `DATABASE_URL` before it decides,
 * and a throw there would fail the import of `pool.ts`, which every API route
 * depends on. Railway restarts on failure five times and then marks the deploy
 * failed, so a safety mechanism that throws at import takes the whole app down
 * — the exact inversion of its purpose, and invisible to `next build`.
 *
 * So the call is wrapped. In production a failure leaves the app running and
 * says so. In a verification process that is not good enough, and
 * `vitest.setup.ts` asserts `barrierInstall.installed` — a barrier that failed
 * to arm must fail the test run loudly rather than let writes through quietly.
 */
export const barrierInstall: InstallResult = (() => {
  try {
    return installProductionWriteBarrier(
      pg as unknown as { Client?: { prototype: Record<string, unknown> }; Pool?: { prototype: Record<string, unknown> } },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[write-barrier] INSTALL FAILED · ${detail}`);
    return {
      installed: false,
      alreadyInstalled: false,
      process: { verification: false, reason: `install threw: ${detail}` },
      target: { kind: 'indeterminate', describe: 'unknown', reason: `install threw: ${detail}` },
      summary: `[write-barrier] install failed · ${detail}`,
    } as InstallResult;
  }
})();
