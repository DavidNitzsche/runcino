import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'lib/**/__tests__/**/*.test.ts'],
    // macOS AppleDouble metadata files (._*) can land on some volumes
    // (SMB shares, USB drives, cloud sync) and get picked up by the
    // glob. Exclude them explicitly.
    exclude: ['**/node_modules/**', '**/dist/**', '**/._*'],
    passWithNoTests: false,
  },
});
