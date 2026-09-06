/**
 * web-v2/vitest.falsify-deterioration.config.ts · the runner for
 * DETERIORATION-SEVERITY-1's Rule 18 falsifier.
 *
 * Same shape and the same argument as `vitest.falsify-continuity.config.ts`:
 * `lib/adaptation/volume-evidence/_falsify_deterioration_severity.script.ts`
 * MUTATES SOURCE FILES on purpose, so it gets its OWN config and is kept out
 * of the default include glob. A normal `npm test` run must never rewrite
 * files underneath itself.
 *
 *     npm --prefix web-v2 run falsify:deterioration
 */
import base from './vitest.config';

export default {
  ...base,
  test: {
    ...(base as { test?: Record<string, unknown> }).test,
    include: ['lib/adaptation/volume-evidence/_falsify_deterioration_severity.script.ts'],
  },
};
