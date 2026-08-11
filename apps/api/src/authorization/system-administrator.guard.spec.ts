import {
  ForbiddenException,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import {
  AUTHENTICATED_USER,
  type AuthenticatedRequest,
} from '../auth/authenticated-request.js';
import { SystemAdministratorGuard } from './system-administrator.guard.js';

function createContext(request: AuthenticatedRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const user = {
  id: 'user-id',
  email: 'operator@example.test',
  displayName: 'Operator',
  isSystemAdministrator: false,
};

describe('SystemAdministratorGuard', () => {
  const guard = new SystemAdministratorGuard();

  it('allows an authenticated system administrator', () => {
    const request: AuthenticatedRequest = { headers: {} };
    request[AUTHENTICATED_USER] = { ...user, isSystemAdministrator: true };
    expect(guard.canActivate(createContext(request))).toBe(true);
  });

  it('rejects an ordinary authenticated user', () => {
    const request: AuthenticatedRequest = { headers: {} };
    request[AUTHENTICATED_USER] = user;
    expect(() => guard.canActivate(createContext(request))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects an unauthenticated request', () => {
    expect(() => guard.canActivate(createContext({ headers: {} }))).toThrow(
      UnauthorizedException,
    );
  });
});
