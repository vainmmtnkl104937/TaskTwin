import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Param,
  UseGuards,
} from '@nestjs/common';

import { CurrentRunner } from '../runner-auth/current-runner.decorator.js';
import type { AuthenticatedRunner } from '../runner-auth/runner-authenticated-request.js';
import { RunnerCredentialGuard } from '../runner-auth/runner-credential.guard.js';
import { CurrentRunLease } from './current-run-lease.decorator.js';
import type { AuthenticatedRunLease } from './runner-job-lease-context.js';
import { RunnerJobLeaseGuard } from './runner-job-lease.guard.js';
import { RunnerJobsService } from './runner-jobs.service.js';

@Controller()
export class RunnerJobsController {
  constructor(private readonly service: RunnerJobsService) {}

  @Post('runner/jobs/claim')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RunnerCredentialGuard)
  claim(@CurrentRunner() runner: AuthenticatedRunner, @Body() body: unknown) {
    return this.service.claim(runner, body);
  }

  @Post('runner/jobs/:workflowRunId/lease/renew')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RunnerCredentialGuard, RunnerJobLeaseGuard)
  renew(
    @CurrentRunner() runner: AuthenticatedRunner,
    @CurrentRunLease() lease: AuthenticatedRunLease,
    @Body() body: unknown,
  ) {
    return this.service.renew(runner, lease, body);
  }

  @Post('runner/jobs/:workflowRunId/progress')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RunnerCredentialGuard, RunnerJobLeaseGuard)
  progress(
    @CurrentRunner() runner: AuthenticatedRunner,
    @CurrentRunLease() lease: AuthenticatedRunLease,
    @Body() body: unknown,
  ) {
    return this.service.progress(runner, lease, body);
  }

  @Post('runner/jobs/:workflowRunId/complete')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RunnerCredentialGuard, RunnerJobLeaseGuard)
  complete(
    @CurrentRunner() runner: AuthenticatedRunner,
    @CurrentRunLease() lease: AuthenticatedRunLease,
    @Body() body: unknown,
  ) {
    return this.service.complete(runner, lease, body);
  }

  @Post('runner/jobs/:workflowRunId/approval-requests')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RunnerCredentialGuard, RunnerJobLeaseGuard)
  createApproval(
    @CurrentRunner() runner: AuthenticatedRunner,
    @CurrentRunLease() lease: AuthenticatedRunLease,
    @Body() body: unknown,
  ) {
    return this.service.createApproval(runner, lease, body);
  }

  @Get('runner/jobs/:workflowRunId/approval-requests/:approvalRequestId')
  @UseGuards(RunnerCredentialGuard, RunnerJobLeaseGuard)
  approvalStatus(
    @CurrentRunner() runner: AuthenticatedRunner,
    @CurrentRunLease() lease: AuthenticatedRunLease,
    @Param('approvalRequestId') approvalRequestId: string,
  ) {
    return this.service.approvalStatus(runner, lease, approvalRequestId);
  }
}
