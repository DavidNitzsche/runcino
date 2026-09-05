/**
 * web-v2/vitest.mileage-replay.config.ts · the runner for MILEAGE-RESPONSIVE-1's
 * real-history replay.
 *
 * Same shape and same argument as `vitest.counterfactual.config.ts`:
 * `lib/adaptation/volume-evidence/_replay_real_history.script.ts` needs the live
 * database and the `@/` alias, this repo has no `tsx`, and vitest is used purely
 * as the TypeScript runner. It gets its OWN config rather than joining
 * `vitest.falsify.config.ts` because it READS PRODUCTION and cannot pass on a
 * clean checkout, and a runner that cannot pass on a clean checkout is a runner
 * nobody will run.
 *
 *     npm --prefix web-v2 run mileage-replay
 */
import base from './vitest.config';

export default {
  ...base,
  test: {
    ...(base as { test?: Record<string, unknown> }).test,
    include: ['lib/adaptation/volume-evidence/_replay_real_history.script.ts'],
  },
};
