/**
 * vitest.organic-push.config.ts · runner for the ORGANIC PUSH WALK
 * (`lib/brain/_organic_push_walk.script.ts`).
 *
 * NOT part of `npm test` — the default config's `include` only matches
 * `*.test.ts`, so this script is invisible to it. Sibling of
 * `vitest.probe.config.ts` and `vitest.shadow-run.config.ts`, and for the
 * same reasons: the walk needs the `@/` alias and the `vitest.setup.ts` load,
 * which is also what ARMS the production write barrier — so this walk cannot
 * reach the owner's live account even if `DATABASE_URL` were pointed there by
 * mistake.
 *
 *   DATABASE_URL=postgresql://david@127.0.0.1:5432/faff_push_walk \
 *     npx vitest run --config vitest.organic-push.config.ts --disable-console-intercept
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
    /* OUTSIDE `lib/` DELIBERATELY. The walk performs test-setup writes to
     * `plan_workouts` (capture a distance, restore it after each proof), and
     * `_automatic_mutations.test.ts` guard 4 correctly reads any such
     * statement under `lib/` as an undeclared plan writer. It is a
     * verification artifact rather than library code, and moving it removes a
     * false positive instead of adding an exemption to a ratchet. */
    include: ['scripts/walks/_organic_push*.script.ts'],
    testTimeout: 600_000,
    passWithNoTests: false,
    // One file at a time, in one process: the walk is a SEQUENCE, and a
    // parallel runner would interleave two stages of one decision.
    fileParallelism: false,
  },
});
