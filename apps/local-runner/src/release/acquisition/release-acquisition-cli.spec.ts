import { describe, expect, it, vi } from 'vitest';

import { runReleaseCli } from '../release-cli.js';

const buildIdentity = {
  product: 'tasktwin-runner' as const,
  version: '1.4.0',
  sourceCommit: 'e'.repeat(40),
  platform: 'windows' as const,
  architecture: 'x64' as const,
  runnerProtocolVersion: 2,
  workflowSchemaVersion: 1,
  localStateSchemaVersion: 1,
  localSecretVaultSchemaVersion: 1,
};

describe('Runner release acquisition CLI', () => {
  it('acquires only a release reference and emits safe cache metadata', async () => {
    const output: string[] = [];
    const acquire = vi.fn().mockResolvedValue({
      idempotent: false,
      release: {
        releaseId: `rr1_${'a'.repeat(64)}`,
        version: '1.5.0',
        target: 'windows/x64',
        verifiedAt: '2026-08-12T01:00:00.000Z',
      },
    });
    const createAcquisitionService = vi.fn().mockResolvedValue({
      acquire,
      list: vi.fn(),
      status: vi.fn(),
    });

    await expect(
      runReleaseCli({
        argv: [
          'release',
          'acquire',
          '1.5.0',
          '--data-root',
          'D:\\TaskTwinData',
        ],
        buildIdentity,
        output: { write: (message) => output.push(message) },
        createAcquisitionService,
      }),
    ).resolves.toBe(0);

    expect(createAcquisitionService).toHaveBeenCalledWith('D:\\TaskTwinData');
    expect(acquire).toHaveBeenCalledWith('1.5.0');
    expect(JSON.parse(output[0] ?? '{}')).toMatchObject({
      idempotent: false,
      release: { version: '1.5.0', target: 'windows/x64' },
    });
    expect(output.join('\n')).not.toMatch(/url|path|command|install|rollback/i);
  });

  it('lists and reports cache status without invoking acquisition', async () => {
    const output: string[] = [];
    const acquire = vi.fn();
    const list = vi.fn().mockResolvedValue([
      {
        releaseId: `rr1_${'a'.repeat(64)}`,
        version: '1.5.0',
        target: 'windows/x64',
        verifiedAt: '2026-08-12T01:00:00.000Z',
      },
    ]);
    const status = vi
      .fn()
      .mockResolvedValue({ verifiedCount: 1, partialCount: 0 });
    const createAcquisitionService = vi.fn().mockResolvedValue({
      acquire,
      list,
      status,
    });

    await expect(
      runReleaseCli({
        argv: ['release', 'cache', 'list'],
        buildIdentity,
        output: { write: (message) => output.push(message) },
        createAcquisitionService,
      }),
    ).resolves.toBe(0);
    await expect(
      runReleaseCli({
        argv: ['release', 'cache', 'status'],
        buildIdentity,
        output: { write: (message) => output.push(message) },
        createAcquisitionService,
      }),
    ).resolves.toBe(0);

    expect(list).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledTimes(1);
    expect(acquire).not.toHaveBeenCalled();
    expect(JSON.parse(output[1] ?? '{}')).toEqual({
      verifiedCount: 1,
      partialCount: 0,
    });
  });

  it('does not accept a user-provided source or artifact URL option', async () => {
    await expect(
      runReleaseCli({
        argv: [
          'release',
          'acquire',
          '1.5.0',
          '--url',
          'https://untrusted.example/runner.zip',
        ],
        buildIdentity,
        output: { write: () => undefined },
        createAcquisitionService: vi.fn(),
      }),
    ).rejects.toThrow(/Unknown option/);
  });
});
