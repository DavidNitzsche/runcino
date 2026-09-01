/**
 * vitest.shadow-run.config.ts · one-off runner for the absorption-reader-split
 * shadow-run script (`lib/adaptation/_shadow_run_absorption_split.script.ts`),
 * docs/reports/absorption-reader-split-2026-09-01.md.
 *
 * NOT part of `npm test` — the default config's `include` only matches TS
 * test files under lib/, so this file is invisible to it. It exists because the
 * shadow-run script is READ-ONLY (no mutation, no `applyAdaptations`, no
 * `tryAdaptiveBump`) and needs the same `@/` alias resolution and the same
 * `.env.local` (production, read-only role) the rest of the suite uses via
 * `vitest.setup.ts` — unlike `vitest.harness.config.ts`, which deliberately
 * points at a local scratch database because ITS suites write.
 *
 * Invoke with:
 *   npx vitest run --config vitest.shadow-run.config.ts
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': root,
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'lib/adaptation/_shadow_run_absorption_split.script.ts',
      'lib/adaptation/_season_sweep_absorption_duration.script.ts',
      'lib/adaptation/_falsify_reason_honesty.script.ts',
    ],
    testTimeout: 60_000,
    passWithNoTests: false,
  },
});
