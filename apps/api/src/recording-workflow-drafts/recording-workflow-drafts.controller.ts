import {
  Body,
  Controller,
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
import type { RecordingWorkflowDraftResponse } from './recording-workflow-draft.contracts.js';
import { RecordingWorkflowDraftsService } from './recording-workflow-drafts.service.js';

const WORKFLOW_DRAFT_WRITER_ROLES = [
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
export class RecordingWorkflowDraftsController {
  constructor(
    private readonly recordingWorkflowDraftsService: RecordingWorkflowDraftsService,
  ) {}

  @Post('recording-sessions/:recordingSessionId/workflow-drafts')
  @HttpCode(HttpStatus.OK)
  @ResolveOrganizationResource('recordingSession', 'recordingSessionId')
  @RequireOrganizationRoles(...WORKFLOW_DRAFT_WRITER_ROLES)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('recordingSessionId') recordingSessionId: string,
    @Body() body: unknown,
  ): Promise<RecordingWorkflowDraftResponse> {
    return this.recordingWorkflowDraftsService.create(
      user.id,
      recordingSessionId,
      body,
    );
  }
}
