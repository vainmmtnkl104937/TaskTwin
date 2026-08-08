import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      '**/*.browser.spec.ts',
      '**/*.windows.integration.spec.ts',
      '**/node_modules/**',
      '**/dist/**',
    ],
  },
});
