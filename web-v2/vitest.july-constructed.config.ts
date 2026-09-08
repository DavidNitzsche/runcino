/**
 * vitest.july-constructed.config.ts · runner for
 * `scripts/walks/_organic_push_july_constructed.script.ts`.
 *
 * Sibling of `vitest.organic-push.config.ts` and for the same reasons: the walk
 * performs test-setup writes against a LOOPBACK scratch database, so it lives
 * outside `lib/` (where `_automatic_mutations.test.ts` guard 4 correctly reads
 * any such statement as an undeclared plan writer), and it needs the `@/` alias
 * plus `vitest.setup.ts`, which is also what ARMS the production write barrier.
 *
 *   DATABASE_URL=postgresql://127.0.0.1:5432/faff_push_walk_jul \
 *   DATABASE_URL_RO=postgresql://127.0.0.1:5432/faff_push_walk_jul \
 *   FAFF_VERIFICATION=1 FAFF_DB_TARGET=local \
 *     npx vitest run --config vitest.july-constructed.config.ts --disable-console-intercept
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
    include: ['scripts/walks/_organic_push_july_constructed.script.ts'],
    testTimeout: 600_000,
    passWithNoTests: false,
    // The three phases are a SEQUENCE against one database. Never interleave.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
