/**
 * web-v2/vitest.counterfactual.config.ts · the runner for the arbitration
 * counterfactual harness.
 *
 * `lib/adaptation/canonical/_counterfactual.script.ts` needs the live database
 * and the `@/` alias, and this repo has no `tsx`. Vitest is used purely as the
 * TypeScript runner, exactly as `vitest.falsify.config.ts` already does for the
 * gate falsifier.
 *
 * It gets its OWN config rather than joining the falsify one, for the reason
 * that config states about the other `.script.ts` in this repo: this harness
 * reads production and cannot pass on a clean checkout, and "a runner that
 * cannot pass on a clean checkout is a runner nobody will run". Keeping it
 * separate means `npm run test:falsify` stays green everywhere.
 *
 *     npm --prefix web-v2 run counterfactual
 */
import base from './vitest.config';

export default {
  ...base,
  test: {
    ...(base as { test?: Record<string, unknown> }).test,
    include: ['lib/adaptation/canonical/_counterfactual.script.ts'],
  },
};
