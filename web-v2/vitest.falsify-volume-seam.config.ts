/**
 * web-v2/vitest.falsify-volume-seam.config.ts · the runner for VOLUMESEAM-1's
 * falsifier.
 *
 * Same shape and same argument as `vitest.falsify-mileage.config.ts`:
 * `lib/plan/_falsify_volume_seam.script.ts` MUTATES SOURCE FILES on purpose,
 * so it must never be picked up by the default include glob that `npm test`
 * runs. It needs no database and passes on a clean checkout.
 *
 *     npm --prefix web-v2 run falsify:volume-seam
 */
import base from './vitest.config';

export default {
  ...base,
  test: {
    ...(base as { test?: Record<string, unknown> }).test,
    include: ['lib/plan/_falsify_volume_seam.script.ts'],
    testTimeout: 900_000,
    hookTimeout: 900_000,
    fileParallelism: false,
  },
};
