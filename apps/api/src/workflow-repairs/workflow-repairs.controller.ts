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
import { WorkflowRepairsService } from './workflow-repairs.service.js';

const READERS = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
  OrganizationRole.MEMBER,
  OrganizationRole.VIEWER,
] as const;
const RETRY_ROLES = [OrganizationRole.OWNER, OrganizationRole.ADMIN] as const;
const ABORT_ROLES = [
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
export class WorkflowRepairsController {
  constructor(private readonly service: WorkflowRepairsService) {}

  @Get('workspaces/:workspaceId/repair-requests')
  @ResolveOrganizationResource('workspace', 'workspaceId')
  @RequireOrganizationRoles(...READERS)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') id: string,
  ) {
    return this.service.list(user.id, id);
  }

  @Get('repair-requests/:repairRequestId')
  @ResolveOrganizationResource('repairRequest', 'repairRequestId')
  @RequireOrganizationRoles(...READERS)
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('repairRequestId') id: string,
  ) {
    return this.service.detail(user.id, id);
  }

  @Post('repair-requests/:repairRequestId/retry')
  @HttpCode(HttpStatus.OK)
  @ResolveOrganizationResource('repairRequest', 'repairRequestId')
  @RequireOrganizationRoles(...RETRY_ROLES)
  retry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('repairRequestId') id: string,
    @Body() body: unknown,
  ) {
    return this.service.decide(user.id, id, 'RETRY_APPROVED', body);
  }

  @Post('repair-requests/:repairRequestId/abort')
  @HttpCode(HttpStatus.OK)
  @ResolveOrganizationResource('repairRequest', 'repairRequestId')
  @RequireOrganizationRoles(...ABORT_ROLES)
  abort(
    @CurrentUser() user: AuthenticatedUser,
    @Param('repairRequestId') id: string,
    @Body() body: unknown,
  ) {
    return this.service.decide(user.id, id, 'ABORTED', body);
  }
}
