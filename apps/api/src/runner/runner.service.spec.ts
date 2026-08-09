import { ForbiddenException } from '@nestjs/common';
import { createHash, generateKeyPairSync } from 'node:crypto';
import {
  RunnerRepositoryError,
  type SecureRunInputRepository,
  type RunnerRepository,
  type RunnerSecretInventoryRepository,
} from '@tasktwin/database';
import { createLocalSecretInventoryDigest } from '@tasktwin/local-secret-store';
import { describe, expect, it, vi } from 'vitest';

import { RunnerService } from './runner.service.js';

const runner = {
  runnerDeviceId: 'b9d35a01-e29a-4894-bc2c-ea9e6b81c889',
  workspaceId: '2a0c786a-3234-42f0-a3bd-b6d7d76dce1f',
  credentialId: 'a550b35f-fb4c-4a74-bdbe-e306a2f2070b',
};

describe('RunnerService heartbeat', () => {
  it('persists only strict software identity metadata', async () => {
    const softwareIdentity = {
      product: 'tasktwin-runner',
      version: '0.1.0',
      runnerProtocolVersion: 2,
      workflowSchemaVersion: 1,
      localStateSchemaVersion: 1,
      platform: 'windows',
      architecture: 'x64',
    } as const;
    const heartbeat = vi.fn().mockResolvedValue(null);
    const service = new RunnerService({
      heartbeat,
    } as unknown as RunnerRepository);
    await service.heartbeat(runner, {
      schemaVersion: 1,
      runnerVersion: softwareIdentity.version,
      softwareIdentity,
    });
    expect(heartbeat).toHaveBeenCalledWith(
      expect.objectContaining({ softwareIdentity }),
    );
    expect(JSON.stringify(heartbeat.mock.calls)).not.toMatch(
      /sourceCommit|installationPath|signing|vault/i,
    );
  });

  it('updates through the repository and returns a bounded interval', async () => {
    const heartbeat = vi.fn().mockResolvedValue(undefined);
    const service = new RunnerService({
      heartbeat,
    } as unknown as RunnerRepository);
    await expect(
      service.heartbeat(runner, {
        schemaVersion: 1,
        runnerVersion: '0.1.0',
      }),
    ).resolves.toMatchObject({
      runnerDeviceId: runner.runnerDeviceId,
      connectionStatus: 'online',
      nextHeartbeatInSeconds: 30,
    });
    expect(heartbeat).toHaveBeenCalledWith(
      expect.objectContaining({
        runnerDeviceId: runner.runnerDeviceId,
        credentialId: runner.credentialId,
        runnerVersion: '0.1.0',
      }),
    );
  });

  it('rejects a runner revoked between guard and update', async () => {
    const service = new RunnerService({
      heartbeat: vi
        .fn()
        .mockRejectedValue(new RunnerRepositoryError('RUNNER_REVOKED')),
    } as unknown as RunnerRepository);
    await expect(
      service.heartbeat(runner, {
        schemaVersion: 1,
        runnerVersion: '0.1.0',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects software identity that conflicts with paired device metadata', async () => {
    const service = new RunnerService({
      heartbeat: vi
        .fn()
        .mockRejectedValue(
          new RunnerRepositoryError('RUNNER_SOFTWARE_IDENTITY_CONFLICT'),
        ),
    } as unknown as RunnerRepository);
    await expect(
      service.heartbeat(runner, {
        schemaVersion: 1,
        runnerVersion: '0.1.0',
        softwareIdentity: {
          product: 'tasktwin-runner',
          version: '0.1.0',
          runnerProtocolVersion: 2,
          workflowSchemaVersion: 1,
          localStateSchemaVersion: 1,
          platform: 'windows',
          architecture: 'x64',
        },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('persists and returns only strict safe runtime metadata', async () => {
    const runtimeReport = {
      schemaVersion: 1 as const,
      runtimeMode: 'service' as const,
      autonomyLevel: 'boot_resilient' as const,
      serviceStatus: 'running' as const,
      secretUnlockMode: 'os_native' as const,
      restartResilient: true,
    };
    const runtimeMetadata = {
      ...runtimeReport,
      runtimeMetadataRevision: 2,
    };
    const heartbeat = vi.fn().mockResolvedValue(runtimeMetadata);
    const service = new RunnerService({
      heartbeat,
    } as unknown as RunnerRepository);
    await expect(
      service.heartbeat(runner, {
        schemaVersion: 1,
        runnerVersion: '0.1.0',
        capabilities: ['runner_service_v1', 'os_native_secret_unlock_v1'],
        runtime: runtimeReport,
      }),
    ).resolves.toMatchObject({ runtime: runtimeMetadata });
    expect(heartbeat).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: runtimeReport }),
    );
    expect(JSON.stringify(heartbeat.mock.calls)).not.toContain('protectedKey');
    expect(JSON.stringify(heartbeat.mock.calls)).not.toContain(
      'serviceAccount',
    );
  });

  it('rejects protected-key and local identity fields in heartbeat metadata', async () => {
    const heartbeat = vi.fn();
    const service = new RunnerService({
      heartbeat,
    } as unknown as RunnerRepository);
    await expect(
      service.heartbeat(runner, {
        schemaVersion: 1,
        runnerVersion: '0.1.0',
        runtime: {
          schemaVersion: 1,
          runtimeMode: 'service',
          autonomyLevel: 'boot_resilient',
          serviceStatus: 'running',
          secretUnlockMode: 'os_native',
          restartResilient: true,
          protectedKey: 'must-never-cross-the-boundary',
        },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(heartbeat).not.toHaveBeenCalled();
  });
});

describe('RunnerService encryption key registration', () => {
  it('recalculates the fingerprint and sends no private material to persistence', async () => {
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 3_072,
      publicExponent: 0x10001,
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    });
    const key = {
      schemaVersion: 1 as const,
      keyId: `rk1_${'A'.repeat(43)}`,
      profile: 'secure_input_envelope_v1' as const,
      algorithm: 'RSA-OAEP-256' as const,
      publicKeyFormat: 'spki' as const,
      publicKeySpki: pair.publicKey.toString('base64url'),
      fingerprint: createHash('sha256').update(pair.publicKey).digest('hex'),
    };
    const registerRunnerKey = vi.fn().mockResolvedValue({
      key,
      idempotent: false,
    });
    const service = new RunnerService(
      {} as RunnerRepository,
      { registerRunnerKey } as unknown as SecureRunInputRepository,
    );
    await expect(
      service.registerEncryptionKey(runner, { schemaVersion: 1, key }),
    ).resolves.toMatchObject({ key, idempotent: false });
    expect(registerRunnerKey).toHaveBeenCalledWith({
      runnerDeviceId: runner.runnerDeviceId,
      key,
    });
    expect(JSON.stringify(registerRunnerKey.mock.calls)).not.toContain(
      pair.privateKey.toString('base64url'),
    );
  });
});

describe('RunnerService local secret inventory', () => {
  it('accepts only safe inventory metadata and returns the trusted revision', async () => {
    const vaultId = '53f321f7-ae3a-4707-b9d0-4f617ea116bd';
    const entries = [
      {
        alias: 'LOGIN_PASSWORD',
        secretVersionId: 'b1304362-6088-44e2-9e8b-64b516ba322d',
      },
    ];
    const inventoryDigest = createLocalSecretInventoryDigest(
      {
        sha256Hex: (value) => createHash('sha256').update(value).digest('hex'),
      },
      {
        vaultId,
        workspaceId: runner.workspaceId,
        runnerDeviceId: runner.runnerDeviceId,
        vaultRevision: 2,
        entries,
      },
    );
    const synchronize = vi.fn().mockResolvedValue({
      idempotent: false,
      inventory: {
        runnerDeviceId: runner.runnerDeviceId,
        workspaceId: runner.workspaceId,
        vaultId,
        vaultRevision: 2,
        storeStatus: 'ready',
        inventoryDigest,
        lastSynchronizedAt: new Date('2026-08-09T00:00:00.000Z'),
        entries,
      },
    });
    const service = new RunnerService({} as RunnerRepository, undefined, {
      synchronize,
    } as unknown as RunnerSecretInventoryRepository);
    const request = {
      schemaVersion: 1,
      profile: 'local_secret_inventory_v1',
      vaultId,
      vaultRevision: 2,
      inventoryDigest,
      storeStatus: 'ready',
      entries,
    };
    await expect(
      service.synchronizeSecretInventory(runner, request),
    ).resolves.toMatchObject({
      vaultId,
      vaultRevision: 2,
      storeStatus: 'ready',
    });
    expect(JSON.stringify(synchronize.mock.calls)).not.toContain('secretValue');
  });

  it('strictly rejects ciphertext and secret value fields', async () => {
    const synchronize = vi.fn();
    const service = new RunnerService({} as RunnerRepository, undefined, {
      synchronize,
    } as unknown as RunnerSecretInventoryRepository);
    await expect(
      service.synchronizeSecretInventory(runner, {
        schemaVersion: 1,
        profile: 'local_secret_inventory_v1',
        storeStatus: 'locked',
        ciphertext: 'forbidden',
        secretValue: 'API_RECOGNIZABLE_SECRET_29',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(synchronize).not.toHaveBeenCalled();
  });
});
