import { describe, expect, it, vi } from 'vitest';

import { bootstrapRunner } from './bootstrap.js';

describe('packaged Runner bootstrap', () => {
  it('configures package-local Chromium before importing the CLI graph', async () => {
    const order: string[] = [];
    const runCli = vi.fn(async () => {
      order.push('run');
      return 0;
    });
    await expect(
      bootstrapRunner({
        argv: ['version'],
        configureBrowserPath: async () => {
          order.push('configure');
        },
        loadCli: async () => {
          order.push('import');
          return { runCli };
        },
      }),
    ).resolves.toBe(0);
    expect(order).toEqual(['configure', 'import', 'run']);
    expect(runCli).toHaveBeenCalledWith(['version']);
  });
});
