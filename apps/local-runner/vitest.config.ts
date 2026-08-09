import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Scrypt-based vault integration tests remain bounded but need headroom
    // while the release gate runs every workspace package concurrently.
    testTimeout: 15_000,
    exclude: [
      '**/*.browser.spec.ts',
      '**/*.windows.integration.spec.ts',
      '**/node_modules/**',
      '**/dist/**',
    ],
  },
});
