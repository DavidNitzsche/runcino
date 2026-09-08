/**
 * web-v2/vitest.glance-replay.config.ts · the runner for GLANCE-FALLBACK-1's
 * real-history replay.
 *
 * Same shape and same argument as `vitest.mileage-replay.config.ts`:
 * `lib/coach/_replay_glance_done_state.script.ts` needs a database and the `@/`
 * alias, this repo has no `tsx`, and vitest is used purely as the TypeScript
 * runner. Its own config rather than the main suite's, because it cannot pass
 * on a clean checkout.
 *
 * Point DATABASE_URL at a LOCAL substrate first — never production:
 *
 *     FAFF_HARNESS_DB=faff_fix_glance_flattering bash scripts/adapt-harness-substrate.sh
 *     DATABASE_URL=postgresql://localhost:5432/faff_fix_glance_flattering \
 *       npx vitest run --config vitest.glance-replay.config.ts
 */
import base from './vitest.config';

export default {
  ...base,
  test: {
    ...(base as { test?: Record<string, unknown> }).test,
    include: ['lib/coach/_replay_glance_done_state.script.ts'],
  },
};
