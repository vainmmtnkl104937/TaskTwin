import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
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
  OccurrenceListResponse,
  WorkflowScheduleListResponse,
  WorkflowScheduleResponse,
} from './workflow-schedule.contracts.js';
import { WorkflowScheduleService } from './workflow-schedule.service.js';

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
export class WorkflowScheduleController {
  constructor(private readonly service: WorkflowScheduleService) {}

  @Post('workflow-versions/:workflowVersionId/schedules')
  @ResolveOrganizationResource('workflowVersion', 'workflowVersionId')
  @RequireOrganizationRoles(...WRITERS)
  async createSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workflowVersionId') workflowVersionId: string,
    @Body() input: unknown,
  ): Promise<WorkflowScheduleResponse> {
    return this.service.create(user.id, workflowVersionId, input);
  }

  @Get('workspaces/:workspaceId/workflow-schedules')
  @ResolveOrganizationResource('workspace', 'workspaceId')
  @RequireOrganizationRoles(...READERS)
  async listSchedules(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<WorkflowScheduleListResponse> {
    return this.service.listByWorkspace(user.id, workspaceId, {
      ...(limit === undefined ? {} : { limit }),
      ...(cursor === undefined ? {} : { cursor }),
    });
  }

  @Get('workflow-schedules/:scheduleId')
  @ResolveOrganizationResource('schedule', 'scheduleId')
  @RequireOrganizationRoles(...READERS)
  async getSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('scheduleId') scheduleId: string,
  ): Promise<WorkflowScheduleResponse> {
    return this.service.getById(user.id, scheduleId);
  }

  @Get('workflow-schedules/:scheduleId/occurrences')
  @ResolveOrganizationResource('schedule', 'scheduleId')
  @RequireOrganizationRoles(...READERS)
  async getOccurrences(
    @CurrentUser() user: AuthenticatedUser,
    @Param('scheduleId') scheduleId: string,
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
  ): Promise<OccurrenceListResponse> {
    const limit = limitStr !== undefined ? parseInt(limitStr, 10) : 50;
    return this.service.getOccurrences(user.id, scheduleId, limit, cursor);
  }

  @Post('workflow-schedules/:scheduleId/pause')
  @ResolveOrganizationResource('schedule', 'scheduleId')
  @RequireOrganizationRoles(...WRITERS)
  async pauseSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('scheduleId') scheduleId: string,
  ): Promise<WorkflowScheduleResponse> {
    return this.service.pause(user.id, scheduleId);
  }

  @Post('workflow-schedules/:scheduleId/resume')
  @ResolveOrganizationResource('schedule', 'scheduleId')
  @RequireOrganizationRoles(...WRITERS)
  async resumeSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('scheduleId') scheduleId: string,
  ): Promise<WorkflowScheduleResponse> {
    return this.service.resume(user.id, scheduleId);
  }

  @Post('workflow-schedules/:scheduleId/archive')
  @ResolveOrganizationResource('schedule', 'scheduleId')
  @RequireOrganizationRoles(...WRITERS)
  async archiveSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('scheduleId') scheduleId: string,
  ): Promise<WorkflowScheduleResponse> {
    return this.service.archive(user.id, scheduleId);
  }
}
