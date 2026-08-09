import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RunnerStartupStatus } from '@tasktwin/runner-update';
import { afterEach, describe, expect, it } from 'vitest';

import { FileRunnerStartupStatusStore } from './startup-status-store.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function status(
  overrides: Partial<RunnerStartupStatus> = {},
): RunnerStartupStatus {
  return {
    schemaVersion: 1,
    activationId: 'release-a',
    startupAttemptId: 'startup-a',
    softwareIdentity: {
      product: 'tasktwin-runner',
      version: '1.4.0',
      runnerProtocolVersion: 2,
      workflowSchemaVersion: 1,
      localStateSchemaVersion: 1,
      platform: 'windows',
      architecture: 'x64',
    },
    state: 'starting',
    observedAt: '2026-08-10T00:00:00.000Z',
    acceptsNewJobs: false,
    activeWork: false,
    checks: {
      identity: 'pending',
      instanceLock: 'pending',
      workflowEngine: 'pending',
      policyRuntime: 'pending',
      chromium: 'pending',
      localSecretStore: 'pending',
      nativeSecretAutoUnlock: 'not_required',
    },
    controlPlaneAcknowledgement: 'not_attempted',
    ...overrides,
  };
}

describe('FileRunnerStartupStatusStore', () => {
  it('atomically round-trips only strict safe startup status', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tasktwin-startup-status-'));
    directories.push(directory);
    const store = new FileRunnerStartupStatusStore(
      join(directory, 'startup-status.v1.json'),
    );
    await store.write(status());
    expect(await store.read()).toEqual(status());
    const rendered = JSON.stringify(await store.read());
    expect(rendered).not.toMatch(
      /UPDATE_SECRET_LEAK_32|UPDATE_CREDENTIAL_LEAK_32|UPDATE_PROTECTED_KEY_LEAK_32|privateKey|vaultId|path/i,
    );
  });

  it('rejects unexpected persisted fields', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tasktwin-startup-status-'));
    directories.push(directory);
    const path = join(directory, 'startup-status.v1.json');
    const store = new FileRunnerStartupStatusStore(path);
    await writeFile(
      path,
      JSON.stringify({ ...status(), installationPath: 'C:\\forbidden' }),
    );
    await expect(store.read()).rejects.toThrow(
      'local Runner update record is invalid',
    );
  });

  it('waits for the expected fresh startup attempt', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tasktwin-startup-status-'));
    directories.push(directory);
    const store = new FileRunnerStartupStatusStore(
      join(directory, 'startup-status.v1.json'),
    );
    await store.write(status());
    const waiting = store.waitForStatus({
      timeoutMilliseconds: 1_000,
      pollIntervalMilliseconds: 5,
      matches: (candidate) =>
        candidate.startupAttemptId === 'startup-b' &&
        candidate.state === 'healthy',
    });
    await store.write(
      status({ startupAttemptId: 'startup-b', state: 'healthy' }),
    );
    await expect(waiting).resolves.toMatchObject({
      startupAttemptId: 'startup-b',
      state: 'healthy',
    });
  });
});
