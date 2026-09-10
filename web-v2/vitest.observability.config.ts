/**
 * vitest.observability.config.ts · the observability falsifier runs on its
 * own config, same reasoning as `vitest.harness.config.ts`.
 *
 * DELIBERATELY SEPARATE FROM `vitest.config.ts`: the default suite's
 * `include` is `lib/**\/*.test.ts` and it loads `.env.local` via
 * `vitest.setup.ts` — which on a developer's machine holds the PRODUCTION
 * `DATABASE_URL`. `lib/observability/harness/*.harness.test.ts` writes real
 * rows to `request_failures` to prove the mechanism actually catches what it
 * claims to (CLAUDE.md Rule 18 — "a gate is not trusted until it has been
 * made to fail"). Sweeping that into `npm test` would point real INSERTs at
 * whatever database `.env.local` names.
 *
 * `lib/observability/harness/**` is excluded from `vitest.config.ts`'s
 * default glob; this config names it explicitly instead.
 * `scripts/observability-falsifier.sh` is the only supported entry point —
 * it exports `DATABASE_URL` to the local scratch database before vitest
 * starts, and this file loads NO `setupFiles`, so `.env.local` is never read
 * on this path regardless of what a developer's machine has in it.
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: { alias: { '@': root } },
  test: {
    environment: 'node',
    include: ['lib/observability/harness/**/*.harness.test.ts'],
    exclude: ['**/node_modules/**', '**/._*'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    pool: 'forks',
    maxWorkers: 1,
    passWithNoTests: false,
  },
});
