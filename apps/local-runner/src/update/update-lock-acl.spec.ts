import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { RunnerInstallationSecurityBoundary } from '../platform/windows/windows-runner-installation-acl.js';
import { FileRunnerUpdateLock } from './update-lock.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Runner update lock ACL boundary', () => {
  it('protects before lock acquisition and validates after acquiring it', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'tasktwin-update-lock-acl-'),
    );
    directories.push(directory);
    const events: string[] = [];
    const boundary: RunnerInstallationSecurityBoundary = {
      protectAndValidate: async () => {
        events.push('protect');
      },
      validate: async () => {
        events.push('validate');
      },
    };
    const lock = new FileRunnerUpdateLock(
      join(directory, 'locks', 'update'),
      undefined,
      boundary,
    );

    const lease = await lock.acquire();
    expect(events).toEqual(['protect', 'protect']);
    await lease.release();
  });

  it('fails closed before acquiring the update lock when ACL protection fails', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'tasktwin-update-lock-acl-'),
    );
    directories.push(directory);
    const boundary: RunnerInstallationSecurityBoundary = {
      protectAndValidate: async () => {
        throw new Error('acl failure');
      },
      validate: async () => undefined,
    };
    const lock = new FileRunnerUpdateLock(
      join(directory, 'locks', 'update'),
      undefined,
      boundary,
    );

    await expect(lock.acquire()).rejects.toThrow('acl failure');
  });
});
