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
import type {
  WorkflowLifecycleActionResponse,
  WorkflowVersionHistoryResponse,
} from './workflow-lifecycle.contracts.js';
import { WorkflowLifecycleService } from './workflow-lifecycle.service.js';

const READER_ROLES = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
  OrganizationRole.MEMBER,
  OrganizationRole.VIEWER,
] as const;
const EDITOR_ROLES = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
  OrganizationRole.MEMBER,
] as const;
const PUBLISHER_ROLES = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
] as const;

@Controller()
@UseGuards(
  JwtAuthGuard,
  OrganizationResourceContextGuard,
  OrganizationRoleGuard,
)
export class WorkflowLifecycleController {
  constructor(
    private readonly workflowLifecycleService: WorkflowLifecycleService,
  ) {}

  @Get('workflows/:workflowId/versions')
  @ResolveOrganizationResource('workflow', 'workflowId')
  @RequireOrganizationRoles(...READER_ROLES)
  listVersions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workflowId') workflowId: string,
  ): Promise<WorkflowVersionHistoryResponse> {
    return this.workflowLifecycleService.listVersions(user.id, workflowId);
  }

  @Post('workflow-versions/:versionId/submit-for-testing')
  @HttpCode(HttpStatus.OK)
  @ResolveOrganizationResource('workflowVersion', 'versionId')
  @RequireOrganizationRoles(...EDITOR_ROLES)
  submitForTesting(
    @CurrentUser() user: AuthenticatedUser,
    @Param('versionId') versionId: string,
    @Body() input: unknown,
  ): Promise<WorkflowLifecycleActionResponse> {
    return this.workflowLifecycleService.submitForTesting(
      user.id,
      versionId,
      input,
    );
  }

  @Post('workflow-versions/:versionId/return-to-draft')
  @HttpCode(HttpStatus.OK)
  @ResolveOrganizationResource('workflowVersion', 'versionId')
  @RequireOrganizationRoles(...EDITOR_ROLES)
  returnToDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('versionId') versionId: string,
    @Body() input: unknown,
  ): Promise<WorkflowLifecycleActionResponse> {
    return this.workflowLifecycleService.returnToDraft(
      user.id,
      versionId,
      input,
    );
  }

  @Post('workflow-versions/:versionId/publish')
  @HttpCode(HttpStatus.OK)
  @ResolveOrganizationResource('workflowVersion', 'versionId')
  @RequireOrganizationRoles(...PUBLISHER_ROLES)
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('versionId') versionId: string,
    @Body() input: unknown,
  ): Promise<WorkflowLifecycleActionResponse> {
    return this.workflowLifecycleService.publish(user.id, versionId, input);
  }

  @Post('workflow-versions/:versionId/archive')
  @HttpCode(HttpStatus.OK)
  @ResolveOrganizationResource('workflowVersion', 'versionId')
  @RequireOrganizationRoles(...PUBLISHER_ROLES)
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('versionId') versionId: string,
    @Body() input: unknown,
  ): Promise<WorkflowLifecycleActionResponse> {
    return this.workflowLifecycleService.archive(user.id, versionId, input);
  }

  @Post('workflows/:workflowId/versions')
  @HttpCode(HttpStatus.OK)
  @ResolveOrganizationResource('workflow', 'workflowId')
  @RequireOrganizationRoles(...EDITOR_ROLES)
  createVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workflowId') workflowId: string,
    @Body() input: unknown,
  ): Promise<WorkflowLifecycleActionResponse> {
    return this.workflowLifecycleService.createVersion(
      user.id,
      workflowId,
      input,
    );
  }
}
