import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  WorkflowRunRepository,
  WorkflowRunRepositoryError,
  createCanonicalJsonDigest,
} from '@tasktwin/database';
import {
  DEFAULT_JOB_POLL_SECONDS,
  DEFAULT_LEASE_RENEW_SECONDS,
  DEFAULT_LEASE_SECONDS,
  LeaseRenewalRequestSchema,
  LeaseRenewalResponseSchema,
  RunnerJobClaimRequestSchema,
  RunnerJobClaimResponseSchema,
  WorkflowProgressBatchResponseSchema,
  WorkflowProgressBatchSchema,
  WorkflowRunCompletionRequestSchema,
  WorkflowRunCompletionResponseSchema,
} from '@tasktwin/run-protocol';

import type { AuthenticatedRunner } from '../runner-auth/runner-authenticated-request.js';
import type { AuthenticatedRunLease } from './runner-job-lease-context.js';
import { RunnerJobLeaseCryptoService } from './runner-job-lease-crypto.service.js';
import { safeRun } from '../workflow-runs/workflow-run-response.mapper.js';

function rethrow(error: unknown): never {
  if (!(error instanceof WorkflowRunRepositoryError)) {
    throw error;
  }
  switch (error.code) {
    case 'RUN_NOT_FOUND':
      throw new NotFoundException();
    case 'RUNNER_MISMATCH':
    case 'RUNNER_REVOKED':
      throw new ForbiddenException();
    case 'LEASE_INVALID':
      throw new UnauthorizedException();
    case 'SERIALIZATION_FAILURE':
      throw new ServiceUnavailableException();
    default:
      throw new ConflictException({
        code: error.code,
        message: 'The runner job operation conflicts with current state.',
      });
  }
}

@Injectable()
export class RunnerJobsService {
  constructor(
    private readonly repository: WorkflowRunRepository,
    private readonly crypto: RunnerJobLeaseCryptoService,
  ) {}

  async claim(runner: AuthenticatedRunner, input: unknown) {
    const request = RunnerJobClaimRequestSchema.safeParse(input);
    if (!request.success) {
      throw new BadRequestException('Invalid runner job claim.');
    }
    const token = this.crypto.deriveToken(
      runner.runnerDeviceId,
      request.data.claimAttemptId,
    );
    try {
      const result = await this.repository.claim({
        runnerDeviceId: runner.runnerDeviceId,
        claimAttemptId: request.data.claimAttemptId,
        leaseTokenHash: this.crypto.hashToken(token),
        now: new Date(),
        leaseExpiresAt: new Date(Date.now() + DEFAULT_LEASE_SECONDS * 1_000),
      });
      return RunnerJobClaimResponseSchema.parse(
        result.status === 'no_job'
          ? {
              schemaVersion: 1,
              status: 'no_job',
              pollAfterSeconds: DEFAULT_JOB_POLL_SECONDS,
            }
          : {
              schemaVersion: 1,
              status: 'claimed',
              job: {
                runId: result.runId,
                definitionDigest: result.definitionDigest,
                workflow: result.workflow,
                runtimeInput: result.runtimeInput,
                allowedOrigins: result.allowedOrigins,
                options: result.options,
                leaseToken: token,
                leaseExpiresAt: result.leaseExpiresAt.toISOString(),
                renewAfterSeconds: DEFAULT_LEASE_RENEW_SECONDS,
              },
            },
      );
    } catch (error: unknown) {
      rethrow(error);
    }
  }

  async renew(
    runner: AuthenticatedRunner,
    lease: AuthenticatedRunLease,
    input: unknown,
  ) {
    if (!LeaseRenewalRequestSchema.safeParse(input).success) {
      throw new BadRequestException('Invalid lease renewal.');
    }
    try {
      const result = await this.repository.renewLease({
        workflowRunId: lease.workflowRunId,
        runnerDeviceId: runner.runnerDeviceId,
        leaseTokenHash: lease.leaseTokenHash,
        now: new Date(),
        leaseExpiresAt: new Date(Date.now() + DEFAULT_LEASE_SECONDS * 1_000),
      });
      return LeaseRenewalResponseSchema.parse({
        schemaVersion: 1,
        leaseExpiresAt: result.leaseExpiresAt.toISOString(),
        renewAfterSeconds: DEFAULT_LEASE_RENEW_SECONDS,
        cancelRequested: result.cancelRequested,
      });
    } catch (error: unknown) {
      rethrow(error);
    }
  }

  async progress(
    runner: AuthenticatedRunner,
    lease: AuthenticatedRunLease,
    input: unknown,
  ) {
    const batch = WorkflowProgressBatchSchema.safeParse(input);
    if (!batch.success) {
      throw new BadRequestException('Invalid workflow progress batch.');
    }
    try {
      const result = await this.repository.ingestProgress({
        workflowRunId: lease.workflowRunId,
        runnerDeviceId: runner.runnerDeviceId,
        leaseTokenHash: lease.leaseTokenHash,
        batch: batch.data,
        payloadDigest: createCanonicalJsonDigest(batch.data),
        now: new Date(),
      });
      return WorkflowProgressBatchResponseSchema.parse({
        schemaVersion: 1,
        ...result,
      });
    } catch (error: unknown) {
      rethrow(error);
    }
  }

  async complete(
    runner: AuthenticatedRunner,
    lease: AuthenticatedRunLease,
    input: unknown,
  ) {
    const completion = WorkflowRunCompletionRequestSchema.safeParse(input);
    if (!completion.success) {
      throw new BadRequestException('Invalid workflow completion.');
    }
    try {
      const result = await this.repository.complete({
        workflowRunId: lease.workflowRunId,
        runnerDeviceId: runner.runnerDeviceId,
        leaseTokenHash: lease.leaseTokenHash,
        completion: {
          ...completion.data,
          digest: createCanonicalJsonDigest(completion.data),
        },
        now: new Date(),
      });
      return WorkflowRunCompletionResponseSchema.parse({
        schemaVersion: 1,
        idempotent: result.idempotent,
        run: safeRun(result.run),
      });
    } catch (error: unknown) {
      rethrow(error);
    }
  }
}
