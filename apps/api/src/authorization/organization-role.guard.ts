import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { OrganizationRole } from '@tasktwin/database';

import {
  type OrganizationContextRequest,
  VERIFIED_ORGANIZATION_CONTEXT,
} from './organization-context.js';
import { ORGANIZATION_ROLES_METADATA } from './organization-roles.decorator.js';

@Injectable()
export class OrganizationRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<OrganizationRole[]>(
      ORGANIZATION_ROLES_METADATA,
      [context.getHandler(), context.getClass()],
    );

    if (requiredRoles === undefined || requiredRoles.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<OrganizationContextRequest>();
    const organizationContext = request[VERIFIED_ORGANIZATION_CONTEXT];

    if (
      organizationContext === undefined ||
      !requiredRoles.includes(organizationContext.role)
    ) {
      throw new ForbiddenException();
    }

    return true;
  }
}
