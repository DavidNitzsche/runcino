/**
 * web-v2/vitest.volume-seam-probe.config.ts · the runner for VOLUMESEAM-1's
 * production probe.
 *
 * Same shape and same argument as `vitest.mileage-replay.config.ts`:
 * `lib/plan/_volume_seam_probe.script.ts` needs the live database and the `@/`
 * alias, this repo has no `tsx`, and vitest is used purely as the TypeScript
 * runner. It gets its OWN config rather than joining the default include glob
 * because it READS PRODUCTION and cannot pass on a clean checkout, and a
 * runner that cannot pass on a clean checkout is a runner nobody will run.
 *
 *     npm --prefix web-v2 run volume-seam-probe
 */
import base from './vitest.config';

export default {
  ...base,
  test: {
    ...(base as { test?: Record<string, unknown> }).test,
    include: ['lib/plan/_volume_seam_probe.script.ts'],
  },
};
