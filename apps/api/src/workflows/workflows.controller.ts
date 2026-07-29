import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { OrganizationRole } from '@tasktwin/database';

import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { OrganizationResourceContextGuard } from '../authorization/organization-resource-context.guard.js';
import { ResolveOrganizationResource } from '../authorization/organization-resource.decorator.js';
import { OrganizationRoleGuard } from '../authorization/organization-role.guard.js';
import { RequireOrganizationRoles } from '../authorization/organization-roles.decorator.js';
import type {
  WorkflowVersionDetailResponse,
  WorkspaceWorkflowListResponse,
} from './workflow.contracts.js';
import { WorkflowsService } from './workflows.service.js';

const READER_ROLES = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
  OrganizationRole.MEMBER,
  OrganizationRole.VIEWER,
] as const;
const WRITER_ROLES = [
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
export class WorkflowsController {
  constructor(private readonly workflowsService: WorkflowsService) {}

  @Get('workspaces/:workspaceId/workflows')
  @ResolveOrganizationResource('workspace', 'workspaceId')
  @RequireOrganizationRoles(...READER_ROLES)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
  ): Promise<WorkspaceWorkflowListResponse> {
    return this.workflowsService.list(user.id, workspaceId);
  }

  @Get('workflow-versions/:workflowVersionId')
  @ResolveOrganizationResource('workflowVersion', 'workflowVersionId')
  @RequireOrganizationRoles(...READER_ROLES)
  getVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workflowVersionId') workflowVersionId: string,
  ): Promise<WorkflowVersionDetailResponse> {
    return this.workflowsService.getVersion(user.id, workflowVersionId);
  }

  @Patch('workflow-versions/:workflowVersionId/draft')
  @ResolveOrganizationResource('workflowVersion', 'workflowVersionId')
  @RequireOrganizationRoles(...WRITER_ROLES)
  updateDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workflowVersionId') workflowVersionId: string,
    @Body() input: unknown,
  ): Promise<WorkflowVersionDetailResponse> {
    return this.workflowsService.updateDraft(user.id, workflowVersionId, input);
  }
}
