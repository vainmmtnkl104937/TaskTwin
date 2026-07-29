import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrganizationRole } from '@tasktwin/database';
import { describe, expect, it, vi } from 'vitest';

import {
  attachVerifiedOrganizationContext,
  type OrganizationContextRequest,
} from './organization-context.js';
import { OrganizationRoleGuard } from './organization-role.guard.js';

function createContext(request: OrganizationContextRequest): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class TestController {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('OrganizationRoleGuard', () => {
  it('allows an exact role from trusted organization context', () => {
    const request: OrganizationContextRequest = {};
    attachVerifiedOrganizationContext(request, {
      organizationId: 'organization-id',
      userId: 'user-id',
      role: OrganizationRole.OWNER,
    });
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue([OrganizationRole.OWNER]),
    } as unknown as Reflector;
    const guard = new OrganizationRoleGuard(reflector);

    expect(guard.canActivate(createContext(request))).toBe(true);
  });

  it('denies client requests without verified organization context', () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue([OrganizationRole.ADMIN]),
    } as unknown as Reflector;
    const guard = new OrganizationRoleGuard(reflector);

    expect(() => guard.canActivate(createContext({}))).toThrow(
      ForbiddenException,
    );
  });

  it('allows routes that do not declare organization roles', () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    const guard = new OrganizationRoleGuard(reflector);

    expect(guard.canActivate(createContext({}))).toBe(true);
  });
});
