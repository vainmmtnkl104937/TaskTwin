import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { IdentityRepository } from '@tasktwin/database';
import { describe, expect, it, vi } from 'vitest';

import {
  AUTHENTICATED_USER,
  type AuthenticatedRequest,
} from './authenticated-request.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

function createContext(request: AuthenticatedRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  it('verifies HS256, loads the active user and attaches a safe principal', async () => {
    const request: AuthenticatedRequest = {
      headers: { authorization: 'Bearer signed-token' },
    };
    const jwtService = {
      verifyAsync: vi.fn().mockResolvedValue({ sub: 'user-id' }),
    } as unknown as JwtService;
    const identityRepository = {
      findSafeUserById: vi.fn().mockResolvedValue({
        id: 'user-id',
        email: 'owner@example.com',
        displayName: 'Owner',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    } as unknown as IdentityRepository;
    const guard = new JwtAuthGuard(jwtService, identityRepository);

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('signed-token', {
      algorithms: ['HS256'],
    });
    expect(request[AUTHENTICATED_USER]).toEqual({
      id: 'user-id',
      email: 'owner@example.com',
      displayName: 'Owner',
    });
  });

  it('rejects a missing bearer token', async () => {
    const guard = new JwtAuthGuard({} as JwtService, {} as IdentityRepository);

    await expect(
      guard.canActivate(createContext({ headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
