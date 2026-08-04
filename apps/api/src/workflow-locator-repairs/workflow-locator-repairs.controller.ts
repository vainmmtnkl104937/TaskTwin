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

import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { WorkflowLocatorRepairsService } from './workflow-locator-repairs.service.js';

@Controller()
@UseGuards(JwtAuthGuard)
export class WorkflowLocatorRepairsController {
  constructor(private readonly service: WorkflowLocatorRepairsService) {}

  @Get('workspaces/:workspaceId/locator-repair-proposals')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
  ) {
    return this.service.list(user.id, workspaceId);
  }

  @Get('locator-repair-proposals/:proposalId')
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('proposalId') proposalId: string,
  ) {
    return this.service.detail(user.id, proposalId);
  }

  @Post('locator-repair-candidates/:candidateId/test')
  @HttpCode(HttpStatus.OK)
  test(
    @CurrentUser() user: AuthenticatedUser,
    @Param('candidateId') candidateId: string,
    @Body() body: unknown,
  ) {
    return this.service.requestTest(user.id, candidateId, body);
  }

  @Post('locator-repair-proposals/:proposalId/apply')
  @HttpCode(HttpStatus.OK)
  apply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('proposalId') proposalId: string,
    @Body() body: unknown,
  ) {
    return this.service.apply(user.id, proposalId, body);
  }
}
