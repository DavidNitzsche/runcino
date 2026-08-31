import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': root,
    },
  },
  test: {
    environment: 'node',
    // Loads .env.local into the test process. See vitest.setup.ts for why the
    // suite ran for months with one permanently-red database test.
    setupFiles: ['./vitest.setup.ts'],
    include: ['lib/**/*.test.ts', 'lib/**/__tests__/**/*.test.ts'],
    // macOS AppleDouble metadata files (._*) can land on some volumes
    // (SMB shares, USB drives, cloud sync) and get picked up by the
    // glob. Exclude them explicitly.
    // lib/adaptation-harness/* is EXCLUDED and must stay excluded.
    //
    // Those suites drive `applyAdaptations`, `tryAdaptiveBump` and
    // `recomputePacesForPlan` — they WRITE — and this config loads `.env.local`
    // via `vitest.setup.ts`, which on a developer machine holds the PRODUCTION
    // DATABASE_URL. Sweeping them into `npm test` would aim writing scenarios
    // at the owner's live plan. `lib/adaptation-harness/fence.ts` would throw
    // before the first query, but a suite that is red for safety reasons is a
    // suite people learn to ignore, which this file's own setup header is about.
    //
    // They run through `npm run harness:adapt` (scripts/adapt-harness.sh), which
    // points DATABASE_URL at a local scratch database first.
    exclude: [
      '**/node_modules/**', '**/dist/**', '**/._*',
      'lib/adaptation-harness/**',
    ],
    passWithNoTests: false,
  },
});
