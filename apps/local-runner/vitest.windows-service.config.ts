import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.windows.integration.spec.ts'],
    testTimeout: 30_000,
  },
});
