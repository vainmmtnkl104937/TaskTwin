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
import type {
  RunnerDeviceListResponse,
  RunnerDeviceRevokeResponse,
  RunnerHeartbeatResponse,
} from '@tasktwin/runner-protocol';

import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { OrganizationResourceContextGuard } from '../authorization/organization-resource-context.guard.js';
import { ResolveOrganizationResource } from '../authorization/organization-resource.decorator.js';
import { CurrentRunner } from '../runner-auth/current-runner.decorator.js';
import type { AuthenticatedRunner } from '../runner-auth/runner-authenticated-request.js';
import { RunnerCredentialGuard } from '../runner-auth/runner-credential.guard.js';
import { RunnerService } from './runner.service.js';

@Controller()
export class RunnerController {
  constructor(private readonly service: RunnerService) {}

  @Post('runner/heartbeat')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RunnerCredentialGuard)
  heartbeat(
    @CurrentRunner() runner: AuthenticatedRunner,
    @Body() body: unknown,
  ): Promise<RunnerHeartbeatResponse> {
    return this.service.heartbeat(runner, body);
  }

  @Post('runner/secret-inventory')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RunnerCredentialGuard)
  synchronizeSecretInventory(
    @CurrentRunner() runner: AuthenticatedRunner,
    @Body() body: unknown,
  ) {
    return this.service.synchronizeSecretInventory(runner, body);
  }

  @Post('runner/encryption-keys')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RunnerCredentialGuard)
  registerEncryptionKey(
    @CurrentRunner() runner: AuthenticatedRunner,
    @Body() body: unknown,
  ) {
    return this.service.registerEncryptionKey(runner, body);
  }

  @Get('workspaces/:workspaceId/runner-devices')
  @UseGuards(JwtAuthGuard, OrganizationResourceContextGuard)
  @ResolveOrganizationResource('workspace', 'workspaceId')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
  ): Promise<RunnerDeviceListResponse> {
    return this.service.listDevices(user.id, workspaceId);
  }

  @Post('runner-devices/:runnerDeviceId/revoke')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, OrganizationResourceContextGuard)
  @ResolveOrganizationResource('runnerDevice', 'runnerDeviceId')
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('runnerDeviceId') runnerDeviceId: string,
  ): Promise<RunnerDeviceRevokeResponse> {
    return this.service.revoke(user.id, runnerDeviceId);
  }
}
