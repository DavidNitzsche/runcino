/**
 * vitest.analysis.config.ts · READ-ONLY prod analyses, deliberately outside CI.
 *
 * The main `vitest.config.ts` includes only `lib/**\/*.test.ts`, so nothing
 * under `scripts/` ever runs in the suite or on a Railway build. An analysis
 * that talks to production must be run on purpose, by name:
 *
 *     npx vitest run --config vitest.analysis.config.ts
 *
 * Same alias and the same `.env.local` loader as the real config, so an
 * analysis imports the SHIPPING engine (`@/lib/...`) rather than a
 * reimplementation of it. Reimplementing is how an impact estimate ends up
 * measuring the estimate instead of the engine.
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: { alias: { '@': root } },
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['scripts/**/*.analysis.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/._*'],
    testTimeout: 120_000,
    passWithNoTests: false,
  },
});
