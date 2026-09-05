/**
 * web-v2/vitest.promotion-replay.config.ts · the runner for the READ-ONLY
 * production promotion replay.
 *
 * `lib/plan/adjudication/_promotion_replay.script.ts` needs the live database
 * and the `@/` alias, and this repo has no `tsx`. Vitest is used purely as the
 * TypeScript runner, exactly as `vitest.counterfactual.config.ts` and
 * `vitest.falsify.config.ts` already are.
 *
 * It gets its OWN config for the reason those two state: this harness reads
 * production and cannot pass on a clean checkout, and "a runner that cannot
 * pass on a clean checkout is a runner nobody will run". Keeping it separate
 * means `npm test` stays green everywhere.
 *
 *     npm --prefix web-v2 run promotion-replay
 */
import base from './vitest.config';

export default {
  ...base,
  test: {
    ...(base as { test?: Record<string, unknown> }).test,
    include: ['lib/plan/adjudication/_promotion_replay.script.ts'],
  },
};
