import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  RUNNER_COMPATIBILITY_HEADER,
  RUNNER_COMPLIANCE_HEADER,
  RUNNER_DESIRED_VERSION_HEADER,
  type RunnerDeviceListResponse,
  type RunnerDeviceRevokeResponse,
  type RunnerHeartbeatResponse,
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
import { ScopedThrottle } from '../http-security/scoped-throttle.decorator.js';
import { AuthenticatedRunnerThrottleGuard } from '../http-security/authenticated-runner-throttle.guard.js';

interface HeaderResponse {
  setHeader(name: string, value: string): void;
}

@Controller()
export class RunnerController {
  constructor(private readonly service: RunnerService) {}

  @Post('runner/heartbeat')
  @ScopedThrottle('runner_standard')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RunnerCredentialGuard, AuthenticatedRunnerThrottleGuard)
  async heartbeat(
    @CurrentRunner() runner: AuthenticatedRunner,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<RunnerHeartbeatResponse> {
    const result = await this.service.heartbeat(runner, body);
    response.setHeader(RUNNER_COMPATIBILITY_HEADER, result.compatibilityStatus);
    response.setHeader(RUNNER_COMPLIANCE_HEADER, result.complianceStatus);
    if (result.desiredVersion !== null) {
      response.setHeader(RUNNER_DESIRED_VERSION_HEADER, result.desiredVersion);
    }
    return result.response;
  }

  @Post('runner/secret-inventory')
  @ScopedThrottle('runner_standard')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RunnerCredentialGuard, AuthenticatedRunnerThrottleGuard)
  synchronizeSecretInventory(
    @CurrentRunner() runner: AuthenticatedRunner,
    @Body() body: unknown,
  ) {
    return this.service.synchronizeSecretInventory(runner, body);
  }

  @Post('runner/encryption-keys')
  @ScopedThrottle('runner_standard')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RunnerCredentialGuard, AuthenticatedRunnerThrottleGuard)
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
