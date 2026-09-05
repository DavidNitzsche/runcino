/**
 * web-v2/vitest.falsify.config.ts · the runner for `*.script.ts` falsifiers.
 *
 * Rule 18 says a gate is not trusted until it has been made to fail, and this
 * repo has one harness that does exactly that —
 * `lib/adaptation/canonical/_falsify_gates.script.ts`. Its own header told you
 * to run it as `npx vitest run lib/adaptation/canonical/_falsify_gates.script.ts`
 * and that command has never worked: `vitest.config.ts` includes only
 * `lib/**` slash `*.test.ts`, a CLI file argument is a FILTER against that include
 * rather than an addition to it, so the command exits "No test files found".
 *
 * A falsifier nobody can run is Rule 18 pointed at itself. This config adds the
 * script pattern and nothing else, so the harness can be run:
 *
 *     npm --prefix web-v2 run test:falsify
 *
 * The `.script.ts` naming stays, because `_zero_mutation_scan.test.ts` treats
 * `.test.ts` under this directory as engine source and the harness legitimately
 * writes planted violations to disk.
 */
import base from './vitest.config';

export default {
  ...base,
  test: {
    ...(base as { test?: Record<string, unknown> }).test,
    // Scoped to the canonical engine's harness on purpose. The other
    // `.script.ts` under `lib/adaptation` is a REPORT tool that reads
    // production and fails without credentials, and a runner that cannot
    // pass on a clean checkout is a runner nobody will run.
    include: ['lib/adaptation/canonical/*.script.ts'],
    // `_counterfactual.script.ts` lives in the same directory and matches the
    // include above, but it reads PRODUCTION through the read-only role and
    // fails without credentials — the exact property this config's own comment
    // says disqualifies a file from this runner. It has its own config
    // (`vitest.counterfactual.config.ts`) and is excluded here so
    // `npm run test:falsify` stays green on a clean checkout.
    exclude: [
      ...((base as { test?: { exclude?: string[] } }).test?.exclude ?? []),
      'lib/adaptation/canonical/_counterfactual.script.ts',
    ],
  },
};
