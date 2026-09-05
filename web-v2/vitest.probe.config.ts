/**
 * vitest.probe.config.ts · runner for the canonical-shadow live probe
 * (`lib/adaptation/canonical-shadow/_live_shadow_probe.script.ts`).
 *
 * NOT part of `npm test` — the default config's `include` only matches
 * `*.test.ts`, so this script is invisible to it. Sibling of
 * `vitest.shadow-run.config.ts`, and for the same reason: the probe is
 * READ-ONLY over `DATABASE_URL_RO` and needs the `@/` alias plus the
 * `.env.local` load that `vitest.setup.ts` performs (which also ARMS the
 * write barrier, so the probe cannot mutate production).
 *
 *   npx vitest run --config vitest.probe.config.ts --disable-console-intercept
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
    include: ['lib/adaptation/canonical-shadow/_live_shadow_probe.script.ts'],
    testTimeout: 300_000,
    passWithNoTests: false,
  },
});
