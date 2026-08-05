import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { OrganizationRole } from '@tasktwin/database';

import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { OrganizationResourceContextGuard } from '../authorization/organization-resource-context.guard.js';
import { ResolveOrganizationResource } from '../authorization/organization-resource.decorator.js';
import { OrganizationRoleGuard } from '../authorization/organization-role.guard.js';
import { RequireOrganizationRoles } from '../authorization/organization-roles.decorator.js';
import type {
  ActiveExecutionPolicyResponse,
  CreateExecutionPolicyVersionResponse,
  ExecutionPolicyVersionListResponse,
} from './execution-policy.contracts.js';
import { ExecutionPolicyService } from './execution-policy.service.js';

const READERS = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
  OrganizationRole.MEMBER,
  OrganizationRole.VIEWER,
] as const;
const WRITERS = [OrganizationRole.OWNER, OrganizationRole.ADMIN] as const;

@Controller('workspaces/:workspaceId/execution-policy')
@UseGuards(
  JwtAuthGuard,
  OrganizationResourceContextGuard,
  OrganizationRoleGuard,
)
export class ExecutionPolicyController {
  constructor(private readonly service: ExecutionPolicyService) {}

  @Get()
  @ResolveOrganizationResource('workspace', 'workspaceId')
  @RequireOrganizationRoles(...READERS)
  active(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
  ): Promise<ActiveExecutionPolicyResponse> {
    return this.service.active(user.id, workspaceId);
  }

  @Get('versions')
  @ResolveOrganizationResource('workspace', 'workspaceId')
  @RequireOrganizationRoles(...READERS)
  versions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
  ): Promise<ExecutionPolicyVersionListResponse> {
    return this.service.versions(user.id, workspaceId);
  }

  @Post('versions')
  @ResolveOrganizationResource('workspace', 'workspaceId')
  @RequireOrganizationRoles(...WRITERS)
  createVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
    @Body() input: unknown,
  ): Promise<CreateExecutionPolicyVersionResponse> {
    return this.service.createVersion(user.id, workspaceId, input);
  }
}
