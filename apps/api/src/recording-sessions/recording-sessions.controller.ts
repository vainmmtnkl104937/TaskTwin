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
import type {
  RecordingEventBatchResponse,
  RecordingSessionCompleteResponse,
  RecordingSessionCreateResponse,
  RecordingSessionMetadataResponse,
} from '@tasktwin/recording-schema';

import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { OrganizationResourceContextGuard } from '../authorization/organization-resource-context.guard.js';
import { ResolveOrganizationResource } from '../authorization/organization-resource.decorator.js';
import { OrganizationRoleGuard } from '../authorization/organization-role.guard.js';
import { RequireOrganizationRoles } from '../authorization/organization-roles.decorator.js';
import { RecordingSessionsService } from './recording-sessions.service.js';

const RECORDING_WRITER_ROLES = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
  OrganizationRole.MEMBER,
] as const;

const RECORDING_READER_ROLES = [
  ...RECORDING_WRITER_ROLES,
  OrganizationRole.VIEWER,
] as const;

@Controller()
@UseGuards(
  JwtAuthGuard,
  OrganizationResourceContextGuard,
  OrganizationRoleGuard,
)
export class RecordingSessionsController {
  constructor(
    private readonly recordingSessionsService: RecordingSessionsService,
  ) {}

  @Post('workspaces/:workspaceId/recording-sessions')
  @HttpCode(HttpStatus.OK)
  @ResolveOrganizationResource('workspace', 'workspaceId')
  @RequireOrganizationRoles(...RECORDING_WRITER_ROLES)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
    @Body() body: unknown,
  ): Promise<RecordingSessionCreateResponse> {
    return this.recordingSessionsService.create(user.id, workspaceId, body);
  }

  @Post('recording-sessions/:recordingSessionId/batches')
  @HttpCode(HttpStatus.OK)
  @ResolveOrganizationResource('recordingSession', 'recordingSessionId')
  @RequireOrganizationRoles(...RECORDING_WRITER_ROLES)
  ingestBatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('recordingSessionId') recordingSessionId: string,
    @Body() body: unknown,
  ): Promise<RecordingEventBatchResponse> {
    return this.recordingSessionsService.ingestBatch(
      user.id,
      recordingSessionId,
      body,
    );
  }

  @Post('recording-sessions/:recordingSessionId/complete')
  @HttpCode(HttpStatus.OK)
  @ResolveOrganizationResource('recordingSession', 'recordingSessionId')
  @RequireOrganizationRoles(...RECORDING_WRITER_ROLES)
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('recordingSessionId') recordingSessionId: string,
    @Body() body: unknown,
  ): Promise<RecordingSessionCompleteResponse> {
    return this.recordingSessionsService.complete(
      user.id,
      recordingSessionId,
      body,
    );
  }

  @Get('recording-sessions/:recordingSessionId')
  @ResolveOrganizationResource('recordingSession', 'recordingSessionId')
  @RequireOrganizationRoles(...RECORDING_READER_ROLES)
  getMetadata(
    @CurrentUser() user: AuthenticatedUser,
    @Param('recordingSessionId') recordingSessionId: string,
  ): Promise<RecordingSessionMetadataResponse> {
    return this.recordingSessionsService.getMetadata(
      user.id,
      recordingSessionId,
    );
  }
}
