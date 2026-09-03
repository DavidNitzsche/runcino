/**
 * scripts/adaptation-real-replay/vitest.config.ts · a SEPARATE runner, and the
 * reason is a real architectural constraint rather than convenience.
 *
 * `web-v2/lib/adaptation/canonical/_cannot_mutate.test.ts` guard 4 asserts that
 * NO file under `web-v2/lib` or `web-v2/app` contains the string
 * `@/lib/adaptation/canonical`, with no allowlist of any kind. Separately,
 * `lib/audit/generated-content-registry.ts` lists every file of that engine in
 * `MODULE_ORPHANS` with the reason "this whole directory is deliberately
 * unwired, and gated that way", and `_generated_content_gate.test.ts`'s
 * staleness check fails the moment any of them gains an importer inside
 * `web-v2/{app,lib,components,scripts}`.
 *
 * A replay has to import the engine to replay it, so an earlier draft of this
 * harness sitting under `web-v2/lib` turned both gates red — correctly. Rather
 * than edit gates this session does not own, or evade guard 4 with a relative
 * import (which would be exactly the "gate that cannot fail" Rule 18 is about),
 * the harness lives at the REPO ROOT alongside `scripts/sim` and
 * `scripts/voice-eval`, outside every directory those gates scan. It is
 * tooling, and it changes nothing either gate says about the application.
 *
 * The consequence is stated in the report: the engine cannot acquire its first
 * consumer INSIDE the app, this harness included, until someone who owns those
 * two gates adds an argued allowlist to them.
 *
 * No `defineConfig` import: this file sits outside `web-v2`, so `vitest/config`
 * does not resolve from here. A plain object is what `defineConfig` returns.
 *
 * Run it with `bash scripts/adaptation-real-replay/run.sh`.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..', '..', 'web-v2');

export default {
  resolve: { alias: { '@': webRoot } },
  test: {
    root: here,
    environment: 'node' as const,
    include: ['*.test.ts'],
    // macOS AppleDouble sidecars land on this volume and oxc cannot parse them.
    // `web-v2/vitest.config.ts` carries the same exclusion for the same reason.
    exclude: ['**/node_modules/**', '**/._*'],
    // No `setupFiles`. The app's `vitest.setup.ts` loads `.env.local` into the
    // process, and this harness must not have a database URL in scope at all:
    // it reads a committed JSON snapshot and nothing else, so the production
    // write barrier never has anything to refuse.
    passWithNoTests: false,
  },
};
