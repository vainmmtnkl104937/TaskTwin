import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { OrganizationRole } from '@tasktwin/database';

import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { OrganizationResourceContextGuard } from '../authorization/organization-resource-context.guard.js';
import { ResolveOrganizationResource } from '../authorization/organization-resource.decorator.js';
import { OrganizationRoleGuard } from '../authorization/organization-role.guard.js';
import { RequireOrganizationRoles } from '../authorization/organization-roles.decorator.js';
import { RunnerRolloutService } from './runner-rollout.service.js';

const READERS = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
  OrganizationRole.MEMBER,
  OrganizationRole.VIEWER,
] as const;
const WRITERS = [OrganizationRole.OWNER, OrganizationRole.ADMIN] as const;

@Controller()
@UseGuards(
  JwtAuthGuard,
  OrganizationResourceContextGuard,
  OrganizationRoleGuard,
)
export class RunnerRolloutController {
  constructor(private readonly service: RunnerRolloutService) {}

  @Post('workspaces/:workspaceId/runner-rollouts')
  @ResolveOrganizationResource('workspace', 'workspaceId')
  @RequireOrganizationRoles(...WRITERS)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
    @Body() input: unknown,
  ) {
    return this.service.create(user.id, workspaceId, input);
  }

  @Get('workspaces/:workspaceId/runner-rollouts')
  @ResolveOrganizationResource('workspace', 'workspaceId')
  @RequireOrganizationRoles(...READERS)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
  ) {
    return this.service.list(user.id, workspaceId);
  }

  @Get('runner-rollouts/:id')
  @ResolveOrganizationResource('runnerRollout', 'id')
  @RequireOrganizationRoles(...READERS)
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.get(user.id, id);
  }

  @Post('runner-rollouts/:id/activate')
  @ResolveOrganizationResource('runnerRollout', 'id')
  @RequireOrganizationRoles(...WRITERS)
  activate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.activate(user.id, id);
  }

  @Post('runner-rollouts/:id/pause')
  @ResolveOrganizationResource('runnerRollout', 'id')
  @RequireOrganizationRoles(...WRITERS)
  pause(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.pause(user.id, id);
  }

  @Post('runner-rollouts/:id/cancel')
  @ResolveOrganizationResource('runnerRollout', 'id')
  @RequireOrganizationRoles(...WRITERS)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.cancel(user.id, id);
  }

  @Post('runner-rollouts/:id/stages/:stageNumber/activate')
  @ResolveOrganizationResource('runnerRollout', 'id')
  @RequireOrganizationRoles(...WRITERS)
  activateStage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('stageNumber') stageNumber: string,
  ) {
    return this.service.activateStage(user.id, id, stageNumber);
  }
}
