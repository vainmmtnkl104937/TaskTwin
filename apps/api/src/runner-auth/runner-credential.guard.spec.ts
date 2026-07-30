import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { RunnerRepository } from '@tasktwin/database';
import { describe, expect, it, vi } from 'vitest';

import type { PairingCryptoService } from '../runner-pairing/pairing-crypto.service.js';
import {
  AUTHENTICATED_RUNNER,
  type RunnerAuthenticatedRequest,
} from './runner-authenticated-request.js';
import { RunnerCredentialGuard } from './runner-credential.guard.js';

const deviceId = 'b9d35a01-e29a-4894-bc2c-ea9e6b81c889';
const credential = 'A'.repeat(43);
const hash = 'b'.repeat(64);

function context(header: string): {
  context: ExecutionContext;
  request: RunnerAuthenticatedRequest;
} {
  const request: RunnerAuthenticatedRequest = {
    headers: { authorization: header },
  };
  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext,
  };
}

function guard(record: object | null) {
  return new RunnerCredentialGuard(
    {
      findRunnerAuthentication: vi.fn().mockResolvedValue(record),
    } as unknown as RunnerRepository,
    {
      hashCredential: vi.fn().mockReturnValue(hash),
    } as unknown as PairingCryptoService,
  );
}

describe('RunnerCredentialGuard', () => {
  it('authenticates a valid runner into a minimal context', async () => {
    const input = context(`TaskTwinRunner ${deviceId}.${credential}`);
    await expect(
      guard({
        runnerDeviceId: deviceId,
        workspaceId: '2a0c786a-3234-42f0-a3bd-b6d7d76dce1f',
        credentialId: 'a550b35f-fb4c-4a74-bdbe-e306a2f2070b',
        credentialHash: hash,
        deviceRevokedAt: null,
        credentialRevokedAt: null,
      }).canActivate(input.context),
    ).resolves.toBe(true);
    expect(input.request[AUTHENTICATED_RUNNER]).toEqual({
      runnerDeviceId: deviceId,
      workspaceId: '2a0c786a-3234-42f0-a3bd-b6d7d76dce1f',
      credentialId: 'a550b35f-fb4c-4a74-bdbe-e306a2f2070b',
    });
  });

  it.each([
    `Bearer ${credential}`,
    `TaskTwinRunner invalid.${credential}`,
    `TaskTwinRunner ${deviceId}.invalid`,
  ])('rejects malformed or JWT authorization: %s', async (header) => {
    await expect(
      guard(null).canActivate(context(header).context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each([
    { deviceRevokedAt: new Date(), credentialRevokedAt: null },
    { deviceRevokedAt: null, credentialRevokedAt: new Date() },
  ])('rejects revoked runner identity', async (revocation) => {
    await expect(
      guard({
        runnerDeviceId: deviceId,
        workspaceId: '2a0c786a-3234-42f0-a3bd-b6d7d76dce1f',
        credentialId: 'a550b35f-fb4c-4a74-bdbe-e306a2f2070b',
        credentialHash: hash,
        ...revocation,
      }).canActivate(
        context(`TaskTwinRunner ${deviceId}.${credential}`).context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
