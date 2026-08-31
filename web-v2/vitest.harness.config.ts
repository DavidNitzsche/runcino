/**
 * vitest.harness.config.ts · the adaptation harness runs on its own config.
 *
 * DELIBERATELY SEPARATE FROM `vitest.config.ts`, for one reason that matters:
 * the default suite's `include` is `lib/**\/*.test.ts`, and it loads
 * `.env.local` — which on a developer's machine holds the PRODUCTION
 * `DATABASE_URL`. These scenarios write. Sweeping them into `npm test` would
 * point writing scenarios at production the first time anyone ran the suite in
 * the root checkout.
 *
 * So the harness files are named `*.harness.test.ts`, the default config's glob
 * does not reach them (it requires `.test.ts` immediately after a name segment
 * this pattern does not produce a match for), and this config names them
 * explicitly. `scripts/adapt-harness.sh` is the only supported entry point and
 * it exports `DATABASE_URL` before vitest starts; `lib/adaptation-harness/
 * fence.ts` then re-checks at run time and throws if it is not the local
 * scratch database.
 *
 * No `setupFiles`. Loading `.env.local` here would be the exact hazard above.
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: { alias: { '@': root } },
  test: {
    environment: 'node',
    include: ['lib/adaptation-harness/**/*.harness.test.ts'],
    // The ledger IS the deliverable. Vitest buffers console output from a
    // passing file and can drop it; the harness's whole point is the report it
    // prints, so the interception is off.
    disableConsoleIntercept: true,
    exclude: ['**/node_modules/**', '**/._*'],
    // Each scenario restores ~50 tables and then drives the real nightly pass.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // One world at a time. They share a database on purpose — isolation comes
    // from `resetToBase`, and parallel files would race each other's restore.
    fileParallelism: false,
    pool: 'forks',
    maxWorkers: 1,
    passWithNoTests: false,
  },
});
