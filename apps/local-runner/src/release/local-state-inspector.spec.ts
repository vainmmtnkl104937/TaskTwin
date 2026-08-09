import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { inspectInstalledRunnerState } from './local-state-inspector.js';

describe('release preflight state inspection', () => {
  it('reads only schema/profile headers and leaves vault and config unchanged', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'tasktwin-preflight-state-'));
    const stateRoot = join(dataRoot, '.tasktwin');
    await mkdir(stateRoot);
    const credentialPath = join(stateRoot, 'runner-credential.json');
    const vaultPath = join(stateRoot, 'local-secret-vault.v1.json');
    const configPath = join(stateRoot, 'runner-config.json');
    const servicePath = join(stateRoot, 'runner-service.v1.json');
    await writeFile(
      credentialPath,
      JSON.stringify({ schemaVersion: 1, marker: 'RUNNER_CREDENTIAL_LEAK_31' }),
    );
    await writeFile(
      vaultPath,
      JSON.stringify({
        schemaVersion: 1,
        masterKeyProtection: {
          profile: 'windows_dpapi_ng_machine_v1',
          marker: 'LOCAL_SECRET_STORE_LEAK_31',
        },
      }),
    );
    await writeFile(configPath, JSON.stringify({ version: '99.0.0' }));
    await writeFile(servicePath, JSON.stringify({ schemaVersion: 1 }));
    const before = await Promise.all([
      readFile(credentialPath),
      readFile(vaultPath),
      readFile(configPath),
      readFile(servicePath),
      stat(credentialPath),
      stat(vaultPath),
      stat(configPath),
      stat(servicePath),
    ]);
    await expect(inspectInstalledRunnerState(dataRoot)).resolves.toEqual({
      currentLocalStateSchemaVersion: 1,
      currentLocalSecretVault: {
        schemaVersion: 1,
        protectionProfile: 'windows_dpapi_ng_machine_v1',
      },
    });
    const after = await Promise.all([
      readFile(credentialPath),
      readFile(vaultPath),
      readFile(configPath),
      readFile(servicePath),
      stat(credentialPath),
      stat(vaultPath),
      stat(configPath),
      stat(servicePath),
    ]);
    expect(after[0]).toEqual(before[0]);
    expect(after[1]).toEqual(before[1]);
    expect(after[2]).toEqual(before[2]);
    expect(after[3]).toEqual(before[3]);
    expect(after[4].mtimeMs).toBe(before[4].mtimeMs);
    expect(after[5].mtimeMs).toBe(before[5].mtimeMs);
    expect(after[6].mtimeMs).toBe(before[6].mtimeMs);
    expect(after[7].mtimeMs).toBe(before[7].mtimeMs);
  });

  it('fails closed for an unknown persisted Runner-state schema', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'tasktwin-preflight-state-'));
    const stateRoot = join(dataRoot, '.tasktwin');
    await mkdir(stateRoot);
    await writeFile(
      join(stateRoot, 'runner-credential.json'),
      JSON.stringify({ schemaVersion: 2 }),
    );
    await expect(inspectInstalledRunnerState(dataRoot)).rejects.toMatchObject({
      code: 'release_state_unsupported',
    });
  });
});
