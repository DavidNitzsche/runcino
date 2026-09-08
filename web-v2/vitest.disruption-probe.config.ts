/**
 * vitest.disruption-probe.config.ts · runner for
 * `scripts/walks/_disruption_discrimination.script.ts`.
 *
 * NOT part of `npm test` — the default config's `include` only matches
 * `*.test.ts`, so this script is invisible to it. Sibling of
 * `vitest.probe.config.ts` and for the same reason: the probe is READ-ONLY
 * over `DATABASE_URL_RO` and needs the `@/` alias plus the `.env.local` load
 * `vitest.setup.ts` performs (which also ARMS the production write barrier).
 *
 *   npx vitest run --config vitest.disruption-probe.config.ts --disable-console-intercept
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
    include: ['scripts/walks/_disruption_discrimination.script.ts'],
    testTimeout: 300_000,
    passWithNoTests: false,
  },
});
