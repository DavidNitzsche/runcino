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
    exclude: ['**/node_modules/**', '**/dist/**', '**/._*'],
    passWithNoTests: false,
  },
});
