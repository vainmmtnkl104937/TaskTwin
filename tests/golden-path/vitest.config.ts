import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.e2e.spec.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    hookTimeout: 60_000,
    testTimeout: 120_000,
  },
});
