/**
 * web-v2/vitest.falsify-continuity.config.ts · the runner for
 * CONTINUOUS-EVIDENCE-1's Rule 18 falsifier.
 *
 * Its own config for the same reason `vitest.falsify-mileage.config.ts` keeps
 * its script out of the default include glob: the script MUTATES SOURCE FILES
 * on purpose, and a normal `npm test` run must never rewrite files underneath
 * itself. It needs no database and passes on a clean checkout.
 *
 *     npm --prefix web-v2 run falsify:continuity
 */
import base from './vitest.config';

export default {
  ...base,
  test: {
    ...(base as { test?: Record<string, unknown> }).test,
    include: ['lib/adaptation/volume-evidence/_falsify_continuity.script.ts'],
    fileParallelism: false,
    disableConsoleIntercept: true,
    testTimeout: 300_000,
  },
};
