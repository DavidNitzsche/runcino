/**
 * A config whose ONLY job is to let a proof harness under `scripts/p0-proof/`
 * run on the app's own module graph — same `@` alias, same `.env.local`
 * loader — without adding a file to `npm test`'s include set.
 *
 * The harnesses here read PRODUCTION. They pin `DATABASE_URL` to
 * `DATABASE_URL_RO` themselves, before the first dynamic import that can reach
 * `lib/db/pool`, and refuse to proceed if the connected role turns out to hold
 * INSERT or UPDATE on the tables they touch. Neither guard is a substitute for
 * the other: the role is the fence, the assertion is the proof.
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  resolve: { alias: { '@': webRoot } },
  test: {
    environment: 'node',
    setupFiles: [path.join(webRoot, 'vitest.setup.ts')],
    include: [path.join(webRoot, 'scripts/p0-proof/*.harness.test.ts')],
    exclude: ['**/node_modules/**', '**/._*'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    passWithNoTests: false,
  },
});
