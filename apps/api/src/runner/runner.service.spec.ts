import { ForbiddenException } from '@nestjs/common';
import { createHash, generateKeyPairSync } from 'node:crypto';
import {
  RunnerRepositoryError,
  type SecureRunInputRepository,
  type RunnerRepository,
} from '@tasktwin/database';
import { describe, expect, it, vi } from 'vitest';

import { RunnerService } from './runner.service.js';

const runner = {
  runnerDeviceId: 'b9d35a01-e29a-4894-bc2c-ea9e6b81c889',
  workspaceId: '2a0c786a-3234-42f0-a3bd-b6d7d76dce1f',
  credentialId: 'a550b35f-fb4c-4a74-bdbe-e306a2f2070b',
};

describe('RunnerService heartbeat', () => {
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
