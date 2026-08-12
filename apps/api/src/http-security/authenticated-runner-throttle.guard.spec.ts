import { type ExecutionContext, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { describe, expect, it, vi } from 'vitest';

import {
  AUTHENTICATED_RUNNER,
  type RunnerAuthenticatedRequest,
} from '../runner-auth/runner-authenticated-request.js';
import { AuthenticatedRunnerThrottleGuard } from './authenticated-runner-throttle.guard.js';
import { digestThrottleIdentity } from './scoped-throttle.guard.js';

const runnerDeviceId = 'b9d35a01-e29a-4894-bc2c-ea9e6b81c889';

function createContext(
  request: RunnerAuthenticatedRequest,
  setHeader = vi.fn(),
): ExecutionContext {
  return {
    getHandler: () => createContext,
    getClass: () => AuthenticatedRunnerThrottleGuard,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ setHeader }),
    }),
  } as unknown as ExecutionContext;
}

function createGuard(options: { blocked?: boolean } = {}) {
  process.env.RUNNER_PAIRING_CODE_PEPPER = 'p'.repeat(32);
  process.env.RUNNER_CREDENTIAL_PEPPER = 'c'.repeat(32);
  const increment = vi.fn().mockResolvedValue({
    totalHits: 1,
    timeToExpire: 60,
    isBlocked: options.blocked ?? false,
    timeToBlockExpire: options.blocked === true ? 17 : 0,
  });
  const guard = new AuthenticatedRunnerThrottleGuard(
    {
      getAllAndOverride: vi.fn().mockReturnValue('runner_standard'),
    } as unknown as Reflector,
    { increment } as unknown as ThrottlerStorage,
  );
  return { guard, increment };
}

describe('AuthenticatedRunnerThrottleGuard', () => {
  it('does not derive a throttle identity from an unauthenticated header', async () => {
    const { guard, increment } = createGuard();
    const request: RunnerAuthenticatedRequest = {
      headers: {
        authorization: `TaskTwinRunner ${runnerDeviceId}.${'A'.repeat(43)}`,
      },
    };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(increment).not.toHaveBeenCalled();
  });

  it('uses only the authenticated Runner context as the device identity', async () => {
    const { guard, increment } = createGuard();
    const request: RunnerAuthenticatedRequest = {
      headers: { authorization: 'TaskTwinRunner attacker-controlled' },
      [AUTHENTICATED_RUNNER]: {
        runnerDeviceId,
        workspaceId: '2a0c786a-3234-42f0-a3bd-b6d7d76dce1f',
        credentialId: 'a550b35f-fb4c-4a74-bdbe-e306a2f2070b',
      },
    };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(increment).toHaveBeenCalledWith(
      digestThrottleIdentity(`runner_standard:runner:${runnerDeviceId}`),
      60_000,
      180,
      30_000,
      'runner_standard_runner',
    );
    expect(increment).toHaveBeenCalledOnce();
  });

  it('returns a bounded retry response when the authenticated device is blocked', async () => {
    const { guard } = createGuard({ blocked: true });
    const setHeader = vi.fn();
    const request: RunnerAuthenticatedRequest = {
      headers: {},
      [AUTHENTICATED_RUNNER]: {
        runnerDeviceId,
        workspaceId: '2a0c786a-3234-42f0-a3bd-b6d7d76dce1f',
        credentialId: 'a550b35f-fb4c-4a74-bdbe-e306a2f2070b',
      },
    };

    const result = guard.canActivate(createContext(request, setHeader));
    await expect(result).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '17');
  });
});
