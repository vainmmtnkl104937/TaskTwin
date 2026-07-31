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
import { WorkflowRunsService } from './workflow-runs.service.js';

const READERS = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
  OrganizationRole.MEMBER,
  OrganizationRole.VIEWER,
] as const;
const WRITERS = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
  OrganizationRole.MEMBER,
] as const;

@Controller()
@UseGuards(
  JwtAuthGuard,
  OrganizationResourceContextGuard,
  OrganizationRoleGuard,
)
export class WorkflowRunsController {
  constructor(private readonly service: WorkflowRunsService) {}

  @Post('workflow-versions/:workflowVersionId/runs')
  @HttpCode(HttpStatus.OK)
  @ResolveOrganizationResource('workflowVersion', 'workflowVersionId')
  @RequireOrganizationRoles(...WRITERS)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workflowVersionId') workflowVersionId: string,
    @Body() body: unknown,
  ) {
    return this.service.create(user.id, workflowVersionId, body);
  }

  @Post('workflow-runs/:workflowRunId/cancel')
  @HttpCode(HttpStatus.OK)
  @ResolveOrganizationResource('workflowRun', 'workflowRunId')
  @RequireOrganizationRoles(...WRITERS)
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workflowRunId') workflowRunId: string,
    @Body() body: unknown,
  ) {
    return this.service.cancel(user.id, workflowRunId, body);
  }

  @Get('workspaces/:workspaceId/workflow-runs')
  @ResolveOrganizationResource('workspace', 'workspaceId')
  @RequireOrganizationRoles(...READERS)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
  ) {
    return this.service.list(user.id, workspaceId);
  }

  @Get('workflow-runs/:workflowRunId')
  @ResolveOrganizationResource('workflowRun', 'workflowRunId')
  @RequireOrganizationRoles(...READERS)
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workflowRunId') workflowRunId: string,
  ) {
    return this.service.detail(user.id, workflowRunId);
  }
}
