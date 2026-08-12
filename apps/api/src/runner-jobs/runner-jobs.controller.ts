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
import { ScopedThrottle } from '../http-security/scoped-throttle.decorator.js';
import { AuthenticatedRunnerThrottleGuard } from '../http-security/authenticated-runner-throttle.guard.js';

@Controller()
@ScopedThrottle('runner_standard')
@UseGuards(RunnerCredentialGuard, AuthenticatedRunnerThrottleGuard)
export class RunnerJobsController {
  constructor(private readonly service: RunnerJobsService) {}

  @Post('runner/jobs/claim')
  @ScopedThrottle('runner_claim')
  @HttpCode(HttpStatus.OK)
  claim(@CurrentRunner() runner: AuthenticatedRunner, @Body() body: unknown) {
    return this.service.claim(runner, body);
  }

  @Post('runner/jobs/:workflowRunId/lease/renew')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RunnerJobLeaseGuard)
  renew(
    @CurrentRunner() runner: AuthenticatedRunner,
    @CurrentRunLease() lease: AuthenticatedRunLease,
    @Body() body: unknown,
  ) {
    return this.service.renew(runner, lease, body);
  }

  @Post('runner/jobs/:workflowRunId/progress')
  @ScopedThrottle('runner_progress')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RunnerJobLeaseGuard)
  progress(
    @CurrentRunner() runner: AuthenticatedRunner,
    @CurrentRunLease() lease: AuthenticatedRunLease,
    @Body() body: unknown,
  ) {
    return this.service.progress(runner, lease, body);
  }

  @Post('runner/jobs/:workflowRunId/complete')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RunnerJobLeaseGuard)
  complete(
    @CurrentRunner() runner: AuthenticatedRunner,
    @CurrentRunLease() lease: AuthenticatedRunLease,
    @Body() body: unknown,
  ) {
    return this.service.complete(runner, lease, body);
  }

  @Post('runner/jobs/:workflowRunId/approval-requests')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RunnerJobLeaseGuard)
  createApproval(
    @CurrentRunner() runner: AuthenticatedRunner,
    @CurrentRunLease() lease: AuthenticatedRunLease,
    @Body() body: unknown,
  ) {
    return this.service.createApproval(runner, lease, body);
  }

  @Get('runner/jobs/:workflowRunId/approval-requests/:approvalRequestId')
  @UseGuards(RunnerJobLeaseGuard)
  approvalStatus(
    @CurrentRunner() runner: AuthenticatedRunner,
    @CurrentRunLease() lease: AuthenticatedRunLease,
    @Param('approvalRequestId') approvalRequestId: string,
  ) {
    return this.service.approvalStatus(runner, lease, approvalRequestId);
  }

  @Post('runner/jobs/:workflowRunId/repair-requests')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RunnerJobLeaseGuard)
  createRepair(
    @CurrentRunner() runner: AuthenticatedRunner,
    @CurrentRunLease() lease: AuthenticatedRunLease,
    @Body() body: unknown,
  ) {
    return this.service.createRepair(runner, lease, body);
  }

  @Get('runner/jobs/:workflowRunId/repair-requests/:repairRequestId')
  @UseGuards(RunnerJobLeaseGuard)
  repairStatus(
    @CurrentRunner() runner: AuthenticatedRunner,
    @CurrentRunLease() lease: AuthenticatedRunLease,
    @Param('repairRequestId') repairRequestId: string,
  ) {
    return this.service.repairStatus(runner, lease, repairRequestId);
  }

  @Get('runner/jobs/:workflowRunId/locator-repairs/discovery/:repairRequestId')
  @UseGuards(RunnerJobLeaseGuard)
  locatorRepairDiscovery(
    @CurrentRunner() runner: AuthenticatedRunner,
    @CurrentRunLease() lease: AuthenticatedRunLease,
    @Param('repairRequestId') repairRequestId: string,
  ) {
    return this.service.locatorRepairDiscovery(runner, lease, repairRequestId);
  }

  @Post('runner/jobs/:workflowRunId/locator-repairs')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RunnerJobLeaseGuard)
  createLocatorRepair(
    @CurrentRunner() runner: AuthenticatedRunner,
    @CurrentRunLease() lease: AuthenticatedRunLease,
    @Body() body: unknown,
  ) {
    return this.service.createLocatorRepair(runner, lease, body);
  }

  @Get('runner/jobs/:workflowRunId/locator-repairs/:proposalId/poll')
  @UseGuards(RunnerJobLeaseGuard)
  pollLocatorRepair(
    @CurrentRunner() runner: AuthenticatedRunner,
    @CurrentRunLease() lease: AuthenticatedRunLease,
    @Param('proposalId') proposalId: string,
  ) {
    return this.service.pollLocatorRepair(runner, lease, proposalId);
  }

  @Post(
    'runner/jobs/:workflowRunId/locator-repairs/:proposalId/candidates/:candidateId/result',
  )
  @HttpCode(HttpStatus.OK)
  @UseGuards(RunnerJobLeaseGuard)
  locatorRepairResult(
    @CurrentRunner() runner: AuthenticatedRunner,
    @CurrentRunLease() lease: AuthenticatedRunLease,
    @Param('candidateId') candidateId: string,
    @Body() body: unknown,
  ) {
    return this.service.submitLocatorRepairTest(
      runner,
      lease,
      candidateId,
      body,
    );
  }
}
