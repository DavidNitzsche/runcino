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

export const barrierInstall: InstallResult = installProductionWriteBarrier(
  pg as unknown as { Client?: { prototype: Record<string, unknown> }; Pool?: { prototype: Record<string, unknown> } },
);
