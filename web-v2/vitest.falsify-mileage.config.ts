/**
 * web-v2/vitest.falsify-mileage.config.ts · the runner for MILEAGE-RESPONSIVE-1's
 * Rule 18 falsifier.
 *
 * Its own config for the same reason `vitest.falsify.config.ts` keeps
 * `_falsify_gates.script.ts` out of the default include glob: the script
 * MUTATES SOURCE FILES on purpose, and a normal `npm test` run must never
 * rewrite files underneath itself. Unlike the replay it needs no database and
 * DOES pass on a clean checkout.
 *
 *     npm --prefix web-v2 run falsify:mileage
 */
import base from './vitest.config';

export default {
  ...base,
  test: {
    ...(base as { test?: Record<string, unknown> }).test,
    include: ['lib/adaptation/volume-evidence/_falsify_mileage_responsive.script.ts'],
    fileParallelism: false,
    disableConsoleIntercept: true,
    testTimeout: 300_000,
  },
};
