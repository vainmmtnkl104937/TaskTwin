import { describe, expect, it, vi } from 'vitest';

import type { RunnerUpdateController } from './update-controller.js';
import { runUpdateCli } from './update-cli.js';

describe('Runner update CLI', () => {
  it('supports safe status, apply, rollback, and recovery commands', async () => {
    const output: string[] = [];
    const controller = {
      status: vi.fn(async () => ({ activeRelease: null, update: null })),
      apply: vi.fn(async () => ({
        state: 'succeeded',
        summary: { updateId: 'safe' },
      })),
      rollback: vi.fn(async () => ({
        state: 'rolled_back',
        summary: { updateId: 'safe' },
      })),
      recover: vi.fn(async () => null),
    } as unknown as RunnerUpdateController;
    const run = (argv: string[]) =>
      runUpdateCli({
        argv,
        output: { write: (message) => output.push(message) },
        createController: async () => controller,
      });

    await expect(run(['update', 'status'])).resolves.toBe(0);
    await expect(
      run([
        'update',
        'apply',
        '--manifest',
        'manifest.json',
        '--signature',
        'signature.json',
        '--artifact',
        'artifact.zip',
      ]),
    ).resolves.toBe(0);
    await expect(run(['update', 'rollback'])).resolves.toBe(0);
    await expect(run(['update', 'recover'])).resolves.toBe(0);
    expect(controller.apply).toHaveBeenCalledWith({
      manifestPath: 'manifest.json',
      signaturePath: 'signature.json',
      artifactPath: 'artifact.zip',
    });
    expect(output).toHaveLength(4);
  });

  it.each([
    '--force',
    '--skip-signature',
    '--ignore-hash',
    '--ignore-compatibility',
  ])('has no integrity or compatibility bypass flag %s', async (flag) => {
    await expect(
      runUpdateCli({
        argv: [
          'update',
          'apply',
          '--manifest',
          'manifest.json',
          '--signature',
          'signature.json',
          '--artifact',
          'artifact.zip',
          flag,
        ],
        output: { write: () => undefined },
        createController: () => {
          throw new Error('must not construct');
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects arbitrary rollback arguments', async () => {
    await expect(
      runUpdateCli({
        argv: ['update', 'rollback', 'C:/arbitrary/runner.exe'],
        output: { write: () => undefined },
        createController: () => {
          throw new Error('must not construct');
        },
      }),
    ).rejects.toThrow();
  });
});
