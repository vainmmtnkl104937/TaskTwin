import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { OrganizationRole } from '@tasktwin/database';

import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { OrganizationResourceContextGuard } from '../authorization/organization-resource-context.guard.js';
import { ResolveOrganizationResource } from '../authorization/organization-resource.decorator.js';
import { OrganizationRoleGuard } from '../authorization/organization-role.guard.js';
import { RequireOrganizationRoles } from '../authorization/organization-roles.decorator.js';
import { WorkflowApprovalsService } from './workflow-approvals.service.js';

const READERS = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
  OrganizationRole.MEMBER,
  OrganizationRole.VIEWER,
] as const;
const DECIDERS = [OrganizationRole.OWNER, OrganizationRole.ADMIN] as const;

@Controller()
@UseGuards(
  JwtAuthGuard,
  OrganizationResourceContextGuard,
  OrganizationRoleGuard,
)
export class WorkflowApprovalsController {
  constructor(private readonly service: WorkflowApprovalsService) {}

  @Get('workspaces/:workspaceId/approval-requests')
  @ResolveOrganizationResource('workspace', 'workspaceId')
  @RequireOrganizationRoles(...READERS)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
  ) {
    return this.service.list(user.id, workspaceId);
  }

  @Get('approval-requests/:approvalRequestId')
  @ResolveOrganizationResource('approvalRequest', 'approvalRequestId')
  @RequireOrganizationRoles(...READERS)
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('approvalRequestId') id: string,
  ) {
    return this.service.detail(user.id, id);
  }

  @Post('approval-requests/:approvalRequestId/approve')
  @HttpCode(HttpStatus.OK)
  @ResolveOrganizationResource('approvalRequest', 'approvalRequestId')
  @RequireOrganizationRoles(...DECIDERS)
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('approvalRequestId') id: string,
    @Body() body: unknown,
  ) {
    return this.service.decide(user.id, id, 'APPROVED', body);
  }

  @Post('approval-requests/:approvalRequestId/reject')
  @HttpCode(HttpStatus.OK)
  @ResolveOrganizationResource('approvalRequest', 'approvalRequestId')
  @RequireOrganizationRoles(...DECIDERS)
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('approvalRequestId') id: string,
    @Body() body: unknown,
  ) {
    return this.service.decide(user.id, id, 'REJECTED', body);
  }
}
