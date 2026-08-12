import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type {
  PairingActionResponse,
  PairingInspectionResponse,
  PairingPollingResponse,
  PairingSessionCreateResponse,
} from '@tasktwin/runner-protocol';

import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { RunnerPairingService } from './runner-pairing.service.js';
import { ScopedThrottle } from '../http-security/scoped-throttle.decorator.js';

@Controller()
export class RunnerPairingController {
  constructor(private readonly service: RunnerPairingService) {}

  @Post('runner-pairing/sessions')
  @ScopedThrottle('pairing_create')
  @HttpCode(HttpStatus.OK)
  create(@Body() body: unknown): Promise<PairingSessionCreateResponse> {
    return this.service.create(body);
  }

  @Post('runner-pairing/token')
  @ScopedThrottle('pairing_poll')
  @HttpCode(HttpStatus.OK)
  poll(@Body() body: unknown): Promise<PairingPollingResponse> {
    return this.service.poll(body);
  }

  @Post('runner-pairing/inspect')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  inspect(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<PairingInspectionResponse> {
    return this.service.inspect(user.id, body);
  }

  @Post('workspaces/:workspaceId/runner-pairing/approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
    @Body() body: unknown,
  ): Promise<PairingActionResponse> {
    return this.service.approve(user.id, workspaceId, body);
  }

  @Post('runner-pairing/deny')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  deny(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<PairingActionResponse> {
    return this.service.deny(user.id, body);
  }
}
