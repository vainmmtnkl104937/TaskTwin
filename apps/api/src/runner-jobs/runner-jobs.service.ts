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
  WorkflowApprovalRepository,
  WorkflowApprovalRepositoryError,
  WorkflowRunRepositoryError,
  WorkflowRepairRepository,
  WorkflowRepairRepositoryError,
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
  UuidSchema,
} from '@tasktwin/run-protocol';
import {
  APPROVAL_POLL_INTERVAL_SECONDS,
  RunnerApprovalRequestCreateSchema,
  RunnerApprovalRequestCreatedSchema,
  RunnerApprovalStatusSchema,
} from '@tasktwin/workflow-approval';
import {
  REPAIR_POLL_INTERVAL_SECONDS,
  RunnerRepairRequestCreateSchema,
  RunnerRepairRequestCreatedSchema,
  RunnerRepairStatusSchema,
} from '@tasktwin/workflow-recovery';

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
    private readonly approvalRepository: WorkflowApprovalRepository,
    private readonly repairRepository: WorkflowRepairRepository,
  ) {}

  private rethrowApproval(error: unknown): never {
    if (!(error instanceof WorkflowApprovalRepositoryError)) throw error;
    switch (error.code) {
      case 'RUN_NOT_FOUND':
      case 'APPROVAL_NOT_FOUND':
        throw new NotFoundException();
      case 'RUNNER_MISMATCH':
        throw new ForbiddenException();
      case 'LEASE_INVALID':
        throw new UnauthorizedException();
      default:
        throw new ConflictException({
          code: error.code,
          message: 'The approval operation conflicts with current state.',
        });
    }
  }

  private rethrowRepair(error: unknown): never {
    if (!(error instanceof WorkflowRepairRepositoryError)) throw error;
    switch (error.code) {
      case 'RUN_NOT_FOUND':
      case 'REPAIR_NOT_FOUND':
        throw new NotFoundException();
      case 'RUNNER_MISMATCH':
        throw new ForbiddenException();
      case 'LEASE_INVALID':
        throw new UnauthorizedException();
      default:
        throw new ConflictException({
          code: error.code,
          message: 'The repair operation conflicts with current state.',
        });
    }
  }

  async createRepair(
    runner: AuthenticatedRunner,
    lease: AuthenticatedRunLease,
    input: unknown,
  ) {
    const request = RunnerRepairRequestCreateSchema.safeParse(input);
    if (!request.success) {
      throw new BadRequestException('Invalid runner repair request.');
    }
    try {
      const result = await this.repairRepository.createForRunner({
        workflowRunId: lease.workflowRunId,
        runnerDeviceId: runner.runnerDeviceId,
        leaseTokenHash: lease.leaseTokenHash,
        request: request.data,
        now: new Date(),
      });
      return RunnerRepairRequestCreatedSchema.parse({
        schemaVersion: 1,
        repairRequestId: result.record.id,
        status: result.record.status,
        retryAllowed: result.record.retryAllowed,
        requestedAt: result.record.requestedAt.toISOString(),
        expiresAt: result.record.expiresAt.toISOString(),
        pollAfterSeconds: REPAIR_POLL_INTERVAL_SECONDS,
        idempotent: result.idempotent,
      });
    } catch (error: unknown) {
      this.rethrowRepair(error);
    }
  }

  async repairStatus(
    runner: AuthenticatedRunner,
    lease: AuthenticatedRunLease,
    repairRequestId: string,
  ) {
    if (!UuidSchema.safeParse(repairRequestId).success) {
      throw new BadRequestException('Invalid repair request identifier.');
    }
    try {
      const record = await this.repairRepository.getForRunner({
        workflowRunId: lease.workflowRunId,
        repairRequestId,
        runnerDeviceId: runner.runnerDeviceId,
        leaseTokenHash: lease.leaseTokenHash,
        now: new Date(),
      });
      return RunnerRepairStatusSchema.parse({
        schemaVersion: 1,
        status: record.status,
        retryAllowed: record.retryAllowed,
        requestedAt: record.requestedAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
        resolvedAt: record.resolvedAt?.toISOString() ?? null,
        pollAfterSeconds: REPAIR_POLL_INTERVAL_SECONDS,
      });
    } catch (error: unknown) {
      this.rethrowRepair(error);
    }
  }

  async createApproval(
    runner: AuthenticatedRunner,
    lease: AuthenticatedRunLease,
    input: unknown,
  ) {
    const request = RunnerApprovalRequestCreateSchema.safeParse(input);
    if (!request.success) {
      throw new BadRequestException('Invalid runner approval request.');
    }
    try {
      const result = await this.approvalRepository.createForRunner({
        workflowRunId: lease.workflowRunId,
        runnerDeviceId: runner.runnerDeviceId,
        leaseTokenHash: lease.leaseTokenHash,
        request: request.data,
        now: new Date(),
      });
      return RunnerApprovalRequestCreatedSchema.parse({
        approvalRequestId: result.record.id,
        status: result.record.status,
        requestedAt: result.record.requestedAt.toISOString(),
        expiresAt: result.record.expiresAt.toISOString(),
        pollAfterSeconds: APPROVAL_POLL_INTERVAL_SECONDS,
        idempotent: result.idempotent,
      });
    } catch (error: unknown) {
      this.rethrowApproval(error);
    }
  }

  async approvalStatus(
    runner: AuthenticatedRunner,
    lease: AuthenticatedRunLease,
    approvalRequestId: string,
  ) {
    try {
      const record = await this.approvalRepository.getForRunner({
        workflowRunId: lease.workflowRunId,
        approvalRequestId,
        runnerDeviceId: runner.runnerDeviceId,
        leaseTokenHash: lease.leaseTokenHash,
        now: new Date(),
      });
      return RunnerApprovalStatusSchema.parse({
        status: record.status,
        requestedAt: record.requestedAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
        resolvedAt: record.resolvedAt?.toISOString() ?? null,
        pollAfterSeconds: APPROVAL_POLL_INTERVAL_SECONDS,
      });
    } catch (error: unknown) {
      this.rethrowApproval(error);
    }
  }

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
