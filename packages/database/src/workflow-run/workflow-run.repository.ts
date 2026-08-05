import {
  validRunTransitions,
  validStepTransitions,
  WorkflowExecutionResultSchema,
  type WorkflowEngineRunStatus,
  type WorkflowEngineStepStatus,
} from '@tasktwin/workflow-engine';
import {
  RUN_PROTOCOL_VERSION,
  analyzeWorkflowRunReadiness,
  canTransitionRunStep,
  type PersistedRunStepStatus,
  type WorkflowProgressBatch,
  type WorkflowRunStatus as ProtocolRunStatus,
} from '@tasktwin/run-protocol';
import { WorkflowDefinitionSchema } from '@tasktwin/workflow-schema';
import {
  WorkspaceExecutionPolicyDefinitionSchema,
  WorkflowPolicyEvaluationSchema,
  evaluateWorkflowPolicy,
} from '@tasktwin/workflow-policy';
import {
  WORKFLOW_EXTRACTION_CAPABILITY,
  WORKFLOW_APPROVAL_CAPABILITY,
  WORKFLOW_VERIFICATION_CAPABILITY,
  WORKFLOW_MANUAL_REPAIR_CAPABILITY,
} from '@tasktwin/runner-protocol';
import { SafeStepAttemptListSchema } from '@tasktwin/workflow-recovery';
import { defineWorkflowOutputs } from '@tasktwin/workflow-extraction';
import {
  RunInputAdditionalAuthenticatedDataSchema,
  SecureRunInputEnvelopeSchema,
  SecureRunInputManifestSchema,
} from '@tasktwin/secure-run-inputs';

import {
  OrganizationRole,
  Prisma,
  WorkflowRunStatus,
  WorkflowRunStepStatus,
  WorkflowRunOutputStatus,
  WorkflowRunOutputType,
  WorkflowApprovalRequestStatus,
  WorkflowRepairRequestStatus,
  WorkflowExecutionEffectCertainty,
  WorkflowRunStepAttemptStatus,
  WorkflowRunStepAttemptTrigger,
  type PrismaClient,
} from '../generated/prisma/client.js';
import { createCanonicalJsonDigest } from '../recording/canonical-json.js';
import { WorkflowRunRepositoryError } from './workflow-run-errors.js';
import type {
  ClaimWorkflowRunResult,
  CompletionInput,
  CompletionResult,
  CreateWorkflowRunResult,
  ProgressBatchResult,
  WorkflowRunAccess,
  WorkflowRunListRecord,
  WorkflowRunRecord,
} from './workflow-run-records.js';

const ACTIVE_STATUSES = [
  WorkflowRunStatus.CLAIMED,
  WorkflowRunStatus.RUNNING,
  WorkflowRunStatus.WAITING_FOR_APPROVAL,
  WorkflowRunStatus.WAITING_FOR_REPAIR,
  WorkflowRunStatus.CANCEL_REQUESTED,
] as const;
const TERMINAL_STATUSES = [
  WorkflowRunStatus.SUCCEEDED,
  WorkflowRunStatus.FAILED,
  WorkflowRunStatus.CANCELLED,
  WorkflowRunStatus.TIMED_OUT,
  WorkflowRunStatus.INTERRUPTED,
] as const;
const WRITER_ROLES = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
  OrganizationRole.MEMBER,
] as const;
const SERIALIZATION_RETRY_COUNT = 3;

const runInclude = {
  workflowVersion: { select: { version: true } },
  steps: {
    orderBy: { sourceStepIndex: 'asc' as const },
    include: { attempts: { orderBy: { attemptNumber: 'asc' as const } } },
  },
  outputs: { orderBy: { producerStepIndex: 'asc' as const } },
  approvalRequests: { orderBy: { requestedAt: 'asc' as const } },
  repairRequests: { orderBy: { requestedAt: 'asc' as const } },
} as const satisfies Prisma.WorkflowRunInclude;

type RunRow = Prisma.WorkflowRunGetPayload<{ include: typeof runInclude }>;

function isSerializationError(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2034' || error.code === 'P2028')
  ) {
    return true;
  }
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  if ('cause' in error) {
    const cause = error.cause;
    if (typeof cause === 'object' && cause !== null) {
      const kind = 'kind' in cause ? cause.kind : undefined;
      const originalCode =
        'originalCode' in cause ? cause.originalCode : undefined;
      if (kind === 'TransactionWriteConflict' || originalCode === '40001') {
        return true;
      }
    }
  }
  if (!('code' in error) || error.code !== 'P2010' || !('meta' in error)) {
    return false;
  }
  const meta = error.meta;
  if (
    typeof meta !== 'object' ||
    meta === null ||
    !('driverAdapterError' in meta)
  ) {
    return false;
  }
  const driverError = meta.driverAdapterError;
  if (
    typeof driverError !== 'object' ||
    driverError === null ||
    !('cause' in driverError)
  ) {
    return false;
  }
  const cause = driverError.cause;
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'originalCode' in cause &&
    cause.originalCode === '40001'
  );
}

function toRecord(row: RunRow): WorkflowRunRecord {
  const finalResult = WorkflowExecutionResultSchema.safeParse(row.finalResult);
  const verificationByStep = new Map(
    finalResult.success
      ? finalResult.data.steps.flatMap((step) =>
          step.verification === undefined
            ? []
            : [[step.stepId, step.verification] as const],
        )
      : [],
  );
  const parsedPolicyEvaluation = WorkflowPolicyEvaluationSchema.safeParse(
    row.policyEvaluation,
  );
  const policyEvaluation = parsedPolicyEvaluation.success
    ? parsedPolicyEvaluation.data
    : null;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    workflowId: row.workflowId,
    workflowVersionId: row.workflowVersionId,
    workflowVersion: row.workflowVersion.version,
    runnerDeviceId: row.runnerDeviceId,
    createdByUserId: row.createdByUserId,
    clientRunId: row.clientRunId,
    status: row.status as ProtocolRunStatus,
    definitionDigest: row.definitionDigest,
    policyVersionId: row.policyVersionId,
    policyDigest: row.policyDigest,
    policyDecision: policyEvaluation?.overallDecision ?? null,
    policyHighestRisk: policyEvaluation?.highestRisk ?? null,
    lastProgressSequence: row.lastProgressSequence,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    claimedAt: row.claimedAt,
    startedAt: row.startedAt,
    cancelRequestedAt: row.cancelRequestedAt,
    finishedAt: row.finishedAt,
    terminationCause: row.terminationCause,
    steps: row.steps.map((step) => ({
      stepId: step.sourceStepId,
      stepIndex: step.sourceStepIndex,
      stepType: step.stepType,
      status: step.status as PersistedRunStepStatus,
      startedAt: step.startedAt,
      finishedAt: step.finishedAt,
      durationMs: step.durationMs,
      errorCode: step.errorCode,
      skippedReason: step.skippedReason,
      attempts:
        step.attempts.length === 0
          ? []
          : SafeStepAttemptListSchema.parse(
              step.attempts.map((attempt) => ({
                attemptNumber: attempt.attemptNumber,
                trigger: {
                  INITIAL: 'initial',
                  AUTOMATIC_RETRY: 'automatic_retry',
                  MANUAL_RETRY: 'manual_retry',
                }[attempt.trigger],
                status: attempt.status.toLowerCase(),
                startedAt: attempt.startedAt.toISOString(),
                ...(attempt.finishedAt === null
                  ? {}
                  : { finishedAt: attempt.finishedAt.toISOString() }),
                ...(attempt.durationMs === null
                  ? {}
                  : { durationMs: attempt.durationMs }),
                ...(attempt.safeErrorCode === null
                  ? {}
                  : { errorCode: attempt.safeErrorCode }),
                effectCertainty: {
                  NOT_STARTED: 'not_started',
                  READ_ONLY: 'read_only',
                  SIDE_EFFECT_POSSIBLE: 'side_effect_possible',
                  COMPLETED: 'completed',
                  UNKNOWN: 'unknown',
                }[attempt.effectCertainty],
                ...(attempt.authorizedByRepairRequestId === null
                  ? {}
                  : { repairRequestId: attempt.authorizedByRepairRequestId }),
              })),
            ),
      ...(verificationByStep.get(step.sourceStepId) === undefined
        ? {}
        : { verification: verificationByStep.get(step.sourceStepId)! }),
    })),
    outputs: row.outputs.map((output) => ({
      outputName: output.outputName,
      outputType:
        output.outputType === WorkflowRunOutputType.STRING
          ? 'string'
          : 'boolean',
      producerStepId: output.producerStepId,
      producerStepIndex: output.producerStepIndex,
      status:
        output.status === WorkflowRunOutputStatus.PRODUCED
          ? 'produced'
          : 'not_produced',
      producedAt: output.producedAt,
    })),
  };
}

function terminal(status: WorkflowRunStatus): boolean {
  return TERMINAL_STATUSES.includes(
    status as (typeof TERMINAL_STATUSES)[number],
  );
}

function persistedStepStatus(
  status: WorkflowEngineStepStatus,
): WorkflowRunStepStatus {
  switch (status) {
    case 'pending':
      return WorkflowRunStepStatus.PENDING;
    case 'running':
      return WorkflowRunStepStatus.RUNNING;
    case 'waiting_for_approval':
      return WorkflowRunStepStatus.WAITING_FOR_APPROVAL;
    case 'waiting_for_repair':
      return WorkflowRunStepStatus.WAITING_FOR_REPAIR;
    case 'succeeded':
      return WorkflowRunStepStatus.SUCCEEDED;
    case 'failed':
      return WorkflowRunStepStatus.FAILED;
    case 'cancelled':
      return WorkflowRunStepStatus.CANCELLED;
    case 'timed_out':
      return WorkflowRunStepStatus.TIMED_OUT;
    case 'skipped':
      return WorkflowRunStepStatus.SKIPPED;
    case 'interrupted':
      return WorkflowRunStepStatus.INTERRUPTED;
  }
}

function persistedRunStatus(
  status: 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'interrupted',
): WorkflowRunStatus {
  return {
    succeeded: WorkflowRunStatus.SUCCEEDED,
    failed: WorkflowRunStatus.FAILED,
    cancelled: WorkflowRunStatus.CANCELLED,
    timed_out: WorkflowRunStatus.TIMED_OUT,
    interrupted: WorkflowRunStatus.INTERRUPTED,
  }[status];
}

function persistedAttemptTrigger(
  trigger: string,
): WorkflowRunStepAttemptTrigger {
  return (
    {
      initial: WorkflowRunStepAttemptTrigger.INITIAL,
      automatic_retry: WorkflowRunStepAttemptTrigger.AUTOMATIC_RETRY,
      manual_retry: WorkflowRunStepAttemptTrigger.MANUAL_RETRY,
    }[trigger] ?? WorkflowRunStepAttemptTrigger.INITIAL
  );
}

function persistedAttemptStatus(status: string): WorkflowRunStepAttemptStatus {
  const value =
    status.toUpperCase() as keyof typeof WorkflowRunStepAttemptStatus;
  return WorkflowRunStepAttemptStatus[value];
}

function persistedEffectCertainty(
  certainty: string,
): WorkflowExecutionEffectCertainty {
  const value =
    certainty.toUpperCase() as keyof typeof WorkflowExecutionEffectCertainty;
  return WorkflowExecutionEffectCertainty[value];
}

function parseJsonArray(input: Prisma.JsonValue): string[] {
  if (
    !Array.isArray(input) ||
    !input.every((value) => typeof value === 'string')
  ) {
    throw new WorkflowRunRepositoryError('RUN_CONFLICT');
  }
  return input;
}

function parseOptions(input: Prisma.JsonValue): {
  totalTimeoutMs: number;
  stepTimeoutMs: number;
  recoveryMode:
    | 'automatic_safe_only'
    | 'automatic_safe_and_manual'
    | 'automatic_safe_and_locator_proposals';
} {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new WorkflowRunRepositoryError('RUN_CONFLICT');
  }
  const totalTimeoutMs = input.totalTimeoutMs;
  const stepTimeoutMs = input.stepTimeoutMs;
  const recoveryMode: unknown = input.recoveryMode ?? 'automatic_safe_only';
  if (
    typeof totalTimeoutMs !== 'number' ||
    typeof stepTimeoutMs !== 'number' ||
    (recoveryMode !== 'automatic_safe_only' &&
      recoveryMode !== 'automatic_safe_and_manual' &&
      recoveryMode !== 'automatic_safe_and_locator_proposals')
  ) {
    throw new WorkflowRunRepositoryError('RUN_CONFLICT');
  }
  return { totalTimeoutMs, stepTimeoutMs, recoveryMode };
}

export class WorkflowRunRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async resolveWorkflowRunAccess(
    userId: string,
    workflowRunId: string,
  ): Promise<WorkflowRunAccess | null> {
    const row = await this.prisma.workflowRun.findFirst({
      where: {
        id: workflowRunId,
        workspace: {
          organization: { members: { some: { userId } } },
        },
      },
      select: {
        workspace: {
          select: {
            organization: {
              select: {
                id: true,
                members: {
                  where: { userId },
                  select: { role: true },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });
    const role = row?.workspace.organization.members[0]?.role;
    return row === null || row === undefined || role === undefined
      ? null
      : {
          organizationId: row.workspace.organization.id,
          userId,
          role,
        };
  }

  createRun(input: {
    actorUserId: string;
    workflowVersionId: string;
    runnerDeviceId: string;
    clientRunId: string;
    options: {
      totalTimeoutMs: number;
      stepTimeoutMs: number;
      recoveryMode:
        | 'automatic_safe_only'
        | 'automatic_safe_and_manual'
        | 'automatic_safe_and_locator_proposals';
    };
  }): Promise<CreateWorkflowRunResult> {
    return this.runSerializable(async (transaction) => {
      const version = await transaction.workflowVersion.findFirst({
        where: {
          id: input.workflowVersionId,
          workflow: {
            workspace: {
              organization: {
                members: { some: { userId: input.actorUserId } },
              },
            },
          },
        },
        select: {
          id: true,
          workflowId: true,
          version: true,
          status: true,
          schemaVersion: true,
          definition: true,
          workflow: { select: { workspaceId: true } },
        },
      });
      if (version === null) {
        throw new WorkflowRunRepositoryError('RUN_NOT_FOUND');
      }
      const access = await this.resolveWorkspaceAccess(
        transaction,
        input.actorUserId,
        version.workflow.workspaceId,
      );
      if (
        access === null ||
        !WRITER_ROLES.includes(access.role as (typeof WRITER_ROLES)[number])
      ) {
        throw new WorkflowRunRepositoryError('RUN_FORBIDDEN');
      }

      const existing = await transaction.workflowRun.findUnique({
        where: {
          workspaceId_clientRunId: {
            workspaceId: version.workflow.workspaceId,
            clientRunId: input.clientRunId,
          },
        },
        include: runInclude,
      });
      if (existing !== null) {
        if (
          existing.workflowVersionId !== input.workflowVersionId ||
          existing.runnerDeviceId !== input.runnerDeviceId
        ) {
          throw new WorkflowRunRepositoryError('RUN_CONFLICT');
        }
        const definition = WorkflowDefinitionSchema.parse(version.definition);
        return {
          run: toRecord(existing),
          idempotent: true,
          readiness: analyzeWorkflowRunReadiness(definition),
        };
      }

      const runner = await transaction.runnerDevice.findFirst({
        where: {
          id: input.runnerDeviceId,
          workspaceId: version.workflow.workspaceId,
        },
        select: { revokedAt: true, capabilities: true },
      });
      if (runner === null) {
        throw new WorkflowRunRepositoryError('RUNNER_MISMATCH');
      }
      if (runner.revokedAt !== null) {
        throw new WorkflowRunRepositoryError('RUNNER_REVOKED');
      }

      const parsed = WorkflowDefinitionSchema.safeParse(version.definition);
      if (
        !parsed.success ||
        version.status !== 'published' ||
        version.schemaVersion !== 1 ||
        parsed.data.workflowId !== version.workflowId ||
        parsed.data.version !== version.version ||
        parsed.data.status !== 'published'
      ) {
        throw new WorkflowRunRepositoryError('RUN_NOT_READY');
      }
      const readiness = analyzeWorkflowRunReadiness(parsed.data);
      if (!readiness.ready) {
        throw new WorkflowRunRepositoryError('RUN_NOT_READY', readiness);
      }
      const activePolicy =
        await transaction.workspaceExecutionPolicyVersion.findFirst({
          where: {
            workspaceId: version.workflow.workspaceId,
            status: 'ACTIVE',
          },
          select: { id: true, revision: true, digest: true, definition: true },
        });
      const parsedPolicy = WorkspaceExecutionPolicyDefinitionSchema.safeParse(
        activePolicy?.definition,
      );
      if (activePolicy === null || !parsedPolicy.success) {
        throw new WorkflowRunRepositoryError('RUN_NOT_READY');
      }
      const definitionDigest = createCanonicalJsonDigest(parsed.data);
      const policyEvaluation = evaluateWorkflowPolicy({
        policy: parsedPolicy.data,
        workflow: parsed.data,
        policyDigest: activePolicy.digest,
        workflowDigest: definitionDigest,
      });
      if (
        policyEvaluation.overallDecision === 'deny' ||
        policyEvaluation.hasBlockingIssues
      ) {
        throw new WorkflowRunRepositoryError('RUN_NOT_READY', policyEvaluation);
      }
      if (
        parsed.data.steps.some((step) => step.type === 'verify') &&
        !runner.capabilities.includes(WORKFLOW_VERIFICATION_CAPABILITY)
      ) {
        throw new WorkflowRunRepositoryError('RUN_NOT_READY', {
          ...readiness,
          ready: false,
          issues: [
            ...readiness.issues,
            {
              code: 'RUNNER_CAPABILITY_UNAVAILABLE',
              message: 'The selected Runner cannot execute Verify steps.',
            },
          ],
        });
      }
      if (
        parsed.data.steps.some((step) => step.type === 'extract') &&
        !runner.capabilities.includes(WORKFLOW_EXTRACTION_CAPABILITY)
      ) {
        throw new WorkflowRunRepositoryError('RUN_NOT_READY', {
          ...readiness,
          ready: false,
          issues: [
            ...readiness.issues,
            {
              code: 'RUNNER_CAPABILITY_UNAVAILABLE',
              message: 'The selected Runner cannot execute Extract steps.',
            },
          ],
        });
      }
      if (
        parsed.data.steps.some((step) => step.type === 'approval') &&
        !runner.capabilities.includes(WORKFLOW_APPROVAL_CAPABILITY)
      ) {
        throw new WorkflowRunRepositoryError('RUN_NOT_READY', {
          ...readiness,
          ready: false,
          issues: [
            ...readiness.issues,
            {
              code: 'RUNNER_CAPABILITY_UNAVAILABLE',
              message: 'The selected Runner cannot coordinate Approval steps.',
            },
          ],
        });
      }
      if (
        input.options.recoveryMode === 'automatic_safe_and_manual' &&
        !runner.capabilities.includes(WORKFLOW_MANUAL_REPAIR_CAPABILITY)
      ) {
        throw new WorkflowRunRepositoryError('RUN_NOT_READY', {
          ...readiness,
          ready: false,
          issues: [
            ...readiness.issues,
            {
              code: 'RUNNER_CAPABILITY_UNAVAILABLE',
              message:
                'The selected Runner does not support attended manual repair.',
            },
          ],
        });
      }
      if (
        input.options.recoveryMode === 'automatic_safe_and_locator_proposals' &&
        !runner.capabilities.includes('locator_repair_proposals_v1')
      ) {
        throw new WorkflowRunRepositoryError('RUN_NOT_READY', {
          ...readiness,
          ready: false,
          issues: [
            ...readiness.issues,
            {
              code: 'RUNNER_CAPABILITY_UNAVAILABLE',
              message:
                'The selected Runner does not support locator repair proposals.',
            },
          ],
        });
      }
      const outputDefinitions = defineWorkflowOutputs(parsed.data);
      const executionOptions = input.options;
      const created = await transaction.workflowRun.create({
        data: {
          workspaceId: version.workflow.workspaceId,
          workflowId: version.workflowId,
          workflowVersionId: version.id,
          runnerDeviceId: input.runnerDeviceId,
          createdByUserId: input.actorUserId,
          clientRunId: input.clientRunId,
          runProtocolVersion: RUN_PROTOCOL_VERSION,
          workflowEngineVersion: 1,
          definitionDigest,
          policyVersionId: activePolicy.id,
          policyDigest: activePolicy.digest,
          policyEvaluation: policyEvaluation as Prisma.InputJsonValue,
          allowedOrigins: readiness.allowedOrigins,
          executionOptions,
          steps: {
            create: parsed.data.steps.map((step, index) => ({
              sourceStepId: step.id,
              sourceStepIndex: index,
              stepType: step.type,
            })),
          },
          outputs: {
            create: outputDefinitions.map((output) => ({
              outputName: output.name,
              outputType:
                output.valueType === 'string'
                  ? WorkflowRunOutputType.STRING
                  : WorkflowRunOutputType.BOOLEAN,
              producerStepId: output.producerStepId,
              producerStepIndex: output.producerStepIndex,
            })),
          },
        },
        include: runInclude,
      });
      return { run: toRecord(created), idempotent: false, readiness };
    });
  }

  claim(input: {
    runnerDeviceId: string;
    claimAttemptId: string;
    leaseTokenHash: string;
    now: Date;
    leaseExpiresAt: Date;
  }): Promise<ClaimWorkflowRunResult> {
    return this.runSerializable(async (transaction) => {
      const runner = await transaction.runnerDevice.findUnique({
        where: { id: input.runnerDeviceId },
        select: { revokedAt: true },
      });
      if (runner === null || runner.revokedAt !== null) {
        throw new WorkflowRunRepositoryError('RUNNER_REVOKED');
      }

      const retried = await transaction.workflowRun.findUnique({
        where: {
          runnerDeviceId_claimAttemptId: {
            runnerDeviceId: input.runnerDeviceId,
            claimAttemptId: input.claimAttemptId,
          },
        },
        select: {
          id: true,
          status: true,
          leaseTokenHash: true,
          leaseExpiresAt: true,
          definitionDigest: true,
          allowedOrigins: true,
          executionOptions: true,
          workflowVersion: { select: { definition: true } },
          policyVersion: {
            select: { id: true, revision: true, definition: true, digest: true },
          },
          policyDigest: true,
          policyEvaluation: true,
          inputEnvelope: {
            include: {
              preparation: {
                select: {
                  variableManifest: true,
                  secretManifest: true,
                  aad: true,
                },
              },
            },
          },
        },
      });
      if (retried !== null) {
        if (
          !ACTIVE_STATUSES.includes(
            retried.status as (typeof ACTIVE_STATUSES)[number],
          ) ||
          retried.leaseTokenHash !== input.leaseTokenHash ||
          retried.leaseExpiresAt === null
        ) {
          throw new WorkflowRunRepositoryError('RUN_CONFLICT');
        }
        if (retried.leaseExpiresAt.getTime() <= input.now.getTime()) {
          await this.interruptLockedRun(transaction, retried.id, input.now);
          return { status: 'no_job' };
        }
        return this.claimedRecord(retried, true);
      }

      const active = await transaction.workflowRun.findFirst({
        where: {
          runnerDeviceId: input.runnerDeviceId,
          status: { in: [...ACTIVE_STATUSES] },
        },
        select: { id: true, leaseExpiresAt: true },
      });
      if (active !== null) {
        if (
          active.leaseExpiresAt !== null &&
          active.leaseExpiresAt.getTime() <= input.now.getTime()
        ) {
          await this.lockRun(transaction, active.id);
          await this.interruptLockedRun(transaction, active.id, input.now);
        } else {
          return { status: 'no_job' };
        }
      }

      const ids = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "workflow_runs"
        WHERE "runner_device_id" = ${input.runnerDeviceId}::uuid
          AND "status" = 'QUEUED'
        ORDER BY "created_at" ASC, "id" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      const runId = ids[0]?.id;
      if (runId === undefined) {
        return { status: 'no_job' };
      }
      const queued = await transaction.workflowRun.findUnique({
        where: { id: runId },
        select: {
          policyVersionId: true,
          workspace: {
            select: {
              executionPolicyVersions: {
                where: { status: 'ACTIVE' },
                select: { id: true },
                take: 1,
              },
            },
          },
        },
      });
      if (
        queued === null ||
        queued.policyVersionId === null ||
        queued.workspace.executionPolicyVersions[0]?.id !== queued.policyVersionId
      ) {
        await transaction.workflowRun.update({
          where: { id: runId },
          data: {
            status: WorkflowRunStatus.FAILED,
            finishedAt: input.now,
            terminationCause: 'policy_changed_before_execution',
            steps: {
              updateMany: {
                where: { status: WorkflowRunStepStatus.PENDING },
                data: {
                  status: WorkflowRunStepStatus.SKIPPED,
                  finishedAt: input.now,
                  skippedReason: 'policy_changed_before_execution',
                },
              },
            },
          },
        });
        return { status: 'no_job' };
      }
      const row = await transaction.workflowRun.update({
        where: { id: runId },
        data: {
          status: WorkflowRunStatus.CLAIMED,
          claimAttemptId: input.claimAttemptId,
          leaseTokenHash: input.leaseTokenHash,
          leaseExpiresAt: input.leaseExpiresAt,
          claimedAt: input.now,
        },
        select: {
          id: true,
          status: true,
          leaseTokenHash: true,
          leaseExpiresAt: true,
          definitionDigest: true,
          allowedOrigins: true,
          executionOptions: true,
          workflowVersion: { select: { definition: true } },
          policyVersion: {
            select: { id: true, revision: true, definition: true, digest: true },
          },
          policyDigest: true,
          policyEvaluation: true,
          inputEnvelope: {
            include: {
              preparation: {
                select: {
                  variableManifest: true,
                  secretManifest: true,
                  aad: true,
                },
              },
            },
          },
        },
      });
      return this.claimedRecord(row, false);
    });
  }

  async renewLease(input: {
    workflowRunId: string;
    runnerDeviceId: string;
    leaseTokenHash: string;
    now: Date;
    leaseExpiresAt: Date;
  }): Promise<{ leaseExpiresAt: Date; cancelRequested: boolean }> {
    await this.expireRunIfRequired(input.workflowRunId, input.now);
    return this.runSerializable(async (transaction) => {
      await this.lockRun(transaction, input.workflowRunId);
      const run = await transaction.workflowRun.findUnique({
        where: { id: input.workflowRunId },
        select: {
          runnerDeviceId: true,
          status: true,
          leaseTokenHash: true,
          leaseExpiresAt: true,
          runnerDevice: {
            select: {
              revokedAt: true,
              credential: { select: { revokedAt: true } },
            },
          },
        },
      });
      this.requireLease(run, input, input.now);
      const updated = await transaction.workflowRun.update({
        where: { id: input.workflowRunId },
        data: { leaseExpiresAt: input.leaseExpiresAt },
        select: { leaseExpiresAt: true, status: true },
      });
      return {
        leaseExpiresAt: updated.leaseExpiresAt!,
        cancelRequested: updated.status === WorkflowRunStatus.CANCEL_REQUESTED,
      };
    });
  }

  async ingestProgress(input: {
    workflowRunId: string;
    runnerDeviceId: string;
    leaseTokenHash: string;
    batch: WorkflowProgressBatch;
    payloadDigest: string;
    now: Date;
  }): Promise<ProgressBatchResult> {
    await this.expireRunIfRequired(input.workflowRunId, input.now);
    return this.runSerializable(async (transaction) => {
      await this.lockRun(transaction, input.workflowRunId);
      const run = await transaction.workflowRun.findUnique({
        where: { id: input.workflowRunId },
        include: runInclude,
      });
      this.requireLease(run, input, input.now);
      if (run === null) {
        throw new WorkflowRunRepositoryError('RUN_NOT_FOUND');
      }
      const existing = await transaction.workflowRunProgressBatch.findUnique({
        where: {
          workflowRunId_clientBatchId: {
            workflowRunId: run.id,
            clientBatchId: input.batch.clientBatchId,
          },
        },
      });
      if (existing !== null) {
        if (
          existing.payloadDigest !== input.payloadDigest ||
          existing.firstSequence !== input.batch.firstSequence ||
          existing.lastSequence !== input.batch.lastSequence
        ) {
          throw new WorkflowRunRepositoryError('PROGRESS_BATCH_CONFLICT');
        }
        return {
          acceptedThroughSequence: existing.lastSequence,
          idempotent: true,
          cancelRequested: run.status === WorkflowRunStatus.CANCEL_REQUESTED,
        };
      }
      if (input.batch.firstSequence !== run.lastProgressSequence + 1) {
        throw new WorkflowRunRepositoryError('PROGRESS_SEQUENCE_INVALID');
      }

      let lastEngineStatus = run.lastEngineStatus;
      const stepById = new Map(
        run.steps.map((step) => [step.sourceStepId, step]),
      );
      const outputByName = new Map(
        run.outputs.map((output) => [output.outputName, output]),
      );
      for (const item of input.batch.events) {
        const event = item.event;
        if (event.executionId !== run.id) {
          throw new WorkflowRunRepositoryError('PROGRESS_TRANSITION_INVALID');
        }
        if (event.kind === 'run_status_changed') {
          if (!this.validEngineRunTransition(lastEngineStatus, event.status)) {
            throw new WorkflowRunRepositoryError('PROGRESS_TRANSITION_INVALID');
          }
          lastEngineStatus = event.status;
          if (
            event.status === 'running' &&
            (run.status === WorkflowRunStatus.CLAIMED ||
              run.status === WorkflowRunStatus.WAITING_FOR_APPROVAL ||
              run.status === WorkflowRunStatus.WAITING_FOR_REPAIR)
          ) {
            run.status = WorkflowRunStatus.RUNNING;
            run.startedAt ??= new Date(event.timestamp);
          }
          if (
            event.status === 'waiting_for_approval' &&
            run.status === WorkflowRunStatus.RUNNING
          ) {
            run.status = WorkflowRunStatus.WAITING_FOR_APPROVAL;
          }
          if (
            event.status === 'waiting_for_repair' &&
            run.status === WorkflowRunStatus.RUNNING
          ) {
            run.status = WorkflowRunStatus.WAITING_FOR_REPAIR;
          }
          continue;
        }
        if (event.kind === 'warning') {
          continue;
        }
        if (event.kind === 'output_produced') {
          const output = outputByName.get(event.outputName);
          const expectedType =
            event.outputType === 'string'
              ? WorkflowRunOutputType.STRING
              : WorkflowRunOutputType.BOOLEAN;
          if (
            output === undefined ||
            output.producerStepId !== event.producerStepId ||
            output.outputType !== expectedType ||
            output.status !== WorkflowRunOutputStatus.NOT_PRODUCED ||
            stepById.get(event.producerStepId)?.status !==
              WorkflowRunStepStatus.RUNNING
          ) {
            throw new WorkflowRunRepositoryError('PROGRESS_TRANSITION_INVALID');
          }
          output.status = WorkflowRunOutputStatus.PRODUCED;
          output.producedAt = new Date(event.timestamp);
          continue;
        }
        if (event.kind === 'approval_status_changed') {
          const request = run.approvalRequests.find(
            (candidate) => candidate.approvalStepId === event.approvalStepId,
          );
          if (
            event.status !== 'PENDING' &&
            (request === undefined ||
              request.gatedStepId !== event.gatedStepId ||
              request.status !== event.status)
          ) {
            throw new WorkflowRunRepositoryError('PROGRESS_TRANSITION_INVALID');
          }
          continue;
        }
        if (event.kind === 'repair_status_changed') {
          const request = run.repairRequests.find(
            (candidate) =>
              candidate.stepId === event.stepId &&
              candidate.attemptNumber === event.attemptNumber,
          );
          if (
            request === undefined ||
            request.status !== event.status ||
            request.retryAllowed !== event.retryAllowed ||
            request.safeErrorCode !== event.errorCode
          ) {
            throw new WorkflowRunRepositoryError('PROGRESS_TRANSITION_INVALID');
          }
          continue;
        }
        if (event.kind === 'step_attempt_status_changed') {
          const step = stepById.get(event.stepId);
          if (step === undefined) {
            throw new WorkflowRunRepositoryError('PROGRESS_TRANSITION_INVALID');
          }
          if (event.status === 'running') {
            if (event.attemptNumber !== step.attempts.length + 1) {
              throw new WorkflowRunRepositoryError(
                'PROGRESS_TRANSITION_INVALID',
              );
            }
            const expectedTrigger =
              event.attemptNumber === 1
                ? 'initial'
                : event.trigger === 'initial'
                  ? null
                  : event.trigger;
            if (expectedTrigger === null) {
              throw new WorkflowRunRepositoryError(
                'PROGRESS_TRANSITION_INVALID',
              );
            }
            let repairRequestId: string | null = null;
            if (event.trigger === 'manual_retry') {
              const request = run.repairRequests.find(
                (candidate) =>
                  candidate.stepId === event.stepId &&
                  candidate.attemptNumber === event.attemptNumber - 1 &&
                  candidate.status ===
                    WorkflowRepairRequestStatus.RETRY_APPROVED,
              );
              if (request === undefined) {
                throw new WorkflowRunRepositoryError(
                  'PROGRESS_TRANSITION_INVALID',
                );
              }
              repairRequestId = request.id;
            }
            const created = await transaction.workflowRunStepAttempt.create({
              data: {
                workflowRunId: run.id,
                workflowRunStepId: step.id,
                attemptNumber: event.attemptNumber,
                trigger: persistedAttemptTrigger(event.trigger),
                status: WorkflowRunStepAttemptStatus.RUNNING,
                startedAt: new Date(event.timestamp),
                effectCertainty: persistedEffectCertainty(
                  event.effectCertainty,
                ),
                authorizedByRepairRequestId: repairRequestId,
              },
            });
            step.attempts.push(created);
          } else {
            const attempt = step.attempts.find(
              (candidate) => candidate.attemptNumber === event.attemptNumber,
            );
            if (
              attempt === undefined ||
              attempt.status !== WorkflowRunStepAttemptStatus.RUNNING ||
              persistedAttemptTrigger(event.trigger) !== attempt.trigger
            ) {
              throw new WorkflowRunRepositoryError(
                'PROGRESS_TRANSITION_INVALID',
              );
            }
            const finishedAt = new Date(event.timestamp);
            const updated = await transaction.workflowRunStepAttempt.update({
              where: { id: attempt.id },
              data: {
                status: persistedAttemptStatus(event.status),
                finishedAt,
                durationMs: Math.max(
                  0,
                  finishedAt.getTime() - attempt.startedAt.getTime(),
                ),
                safeErrorCode: event.errorCode ?? null,
                effectCertainty: persistedEffectCertainty(
                  event.effectCertainty,
                ),
              },
            });
            Object.assign(attempt, updated);
          }
          continue;
        }
        const step = stepById.get(event.stepId);
        if (
          step === undefined ||
          step.stepType !== event.stepType ||
          !this.validEngineStepTransition(step.lastEngineStatus, event.status)
        ) {
          throw new WorkflowRunRepositoryError('PROGRESS_TRANSITION_INVALID');
        }
        const next = persistedStepStatus(event.status);
        if (
          step.status !== next &&
          !canTransitionRunStep(
            step.status as PersistedRunStepStatus,
            next as PersistedRunStepStatus,
          )
        ) {
          throw new WorkflowRunRepositoryError('PROGRESS_TRANSITION_INVALID');
        }
        if (
          next === WorkflowRunStepStatus.RUNNING &&
          run.steps.some(
            (candidate) =>
              candidate.id !== step.id &&
              candidate.status === WorkflowRunStepStatus.RUNNING,
          )
        ) {
          throw new WorkflowRunRepositoryError('PROGRESS_TRANSITION_INVALID');
        }
        step.lastEngineStatus = event.status;
        step.status = next;
        if (event.status === 'running') {
          step.startedAt = new Date(event.timestamp);
        }
        if (
          [
            'succeeded',
            'failed',
            'cancelled',
            'timed_out',
            'skipped',
            'interrupted',
          ].includes(event.status)
        ) {
          step.finishedAt = new Date(event.timestamp);
        }
        step.errorCode = event.errorCode ?? null;
        step.skippedReason = event.skippedReason ?? null;
      }

      for (const step of run.steps) {
        await transaction.workflowRunStep.update({
          where: { id: step.id },
          data: {
            status: step.status,
            lastEngineStatus: step.lastEngineStatus,
            startedAt: step.startedAt,
            finishedAt: step.finishedAt,
            errorCode: step.errorCode,
            skippedReason: step.skippedReason,
          },
        });
      }
      for (const output of run.outputs) {
        await transaction.workflowRunOutput.update({
          where: { id: output.id },
          data: { status: output.status, producedAt: output.producedAt },
        });
      }
      await transaction.workflowRunProgressBatch.create({
        data: {
          workflowRunId: run.id,
          clientBatchId: input.batch.clientBatchId,
          firstSequence: input.batch.firstSequence,
          lastSequence: input.batch.lastSequence,
          eventCount: input.batch.events.length,
          payloadDigest: input.payloadDigest,
        },
      });
      await transaction.workflowRun.update({
        where: { id: run.id },
        data: {
          status: run.status,
          startedAt: run.startedAt,
          lastEngineStatus,
          lastProgressSequence: input.batch.lastSequence,
        },
      });
      return {
        acceptedThroughSequence: input.batch.lastSequence,
        idempotent: false,
        cancelRequested: run.status === WorkflowRunStatus.CANCEL_REQUESTED,
      };
    });
  }

  async complete(input: {
    workflowRunId: string;
    runnerDeviceId: string;
    leaseTokenHash: string;
    completion: CompletionInput;
    now: Date;
  }): Promise<CompletionResult> {
    await this.expireRunIfRequired(input.workflowRunId, input.now);
    return this.runSerializable(async (transaction) => {
      await this.lockRun(transaction, input.workflowRunId);
      const run = await transaction.workflowRun.findUnique({
        where: { id: input.workflowRunId },
        include: runInclude,
      });
      if (run === null) {
        throw new WorkflowRunRepositoryError('RUN_NOT_FOUND');
      }
      if (terminal(run.status)) {
        if (
          run.clientCompletionId === input.completion.clientCompletionId &&
          run.completionDigest === input.completion.digest
        ) {
          return { run: toRecord(run), idempotent: true };
        }
        if (
          run.status === WorkflowRunStatus.TIMED_OUT &&
          run.terminationCause === 'approval_expired' &&
          run.clientCompletionId === null
        ) {
          const expiredResult = WorkflowExecutionResultSchema.safeParse(
            input.completion.result,
          );
          const stepsMatch =
            expiredResult.success &&
            expiredResult.data.executionId === run.id &&
            expiredResult.data.status === 'timed_out' &&
            expiredResult.data.terminationCause === 'approval_expired' &&
            expiredResult.data.steps.length === run.steps.length &&
            expiredResult.data.steps.every(
              (step, index) =>
                step.stepId === run.steps[index]?.sourceStepId &&
                step.stepType === run.steps[index]?.stepType,
            );
          if (!stepsMatch) {
            throw new WorkflowRunRepositoryError('COMPLETION_INVALID');
          }
          const updated = await transaction.workflowRun.update({
            where: { id: run.id },
            data: {
              clientCompletionId: input.completion.clientCompletionId,
              completionDigest: input.completion.digest,
              finalResult: input.completion.result as Prisma.InputJsonValue,
            },
            include: runInclude,
          });
          return { run: toRecord(updated), idempotent: false };
        }
        throw new WorkflowRunRepositoryError('COMPLETION_CONFLICT');
      }
      this.requireLease(run, input, input.now);
      const result = WorkflowExecutionResultSchema.parse(
        input.completion.result,
      );
      if (
        result.executionId !== run.id ||
        result.steps.length !== run.steps.length
      ) {
        throw new WorkflowRunRepositoryError('COMPLETION_INVALID');
      }
      result.steps.forEach((step, index) => {
        const source = run.steps[index];
        if (
          source === undefined ||
          source.sourceStepId !== step.stepId ||
          source.stepType !== step.stepType
        ) {
          throw new WorkflowRunRepositoryError('COMPLETION_INVALID');
        }
        if (source.attempts.length > 0) {
          const attempts = step.attempts ?? [];
          if (
            attempts.length !== source.attempts.length ||
            attempts.some((attempt, attemptIndex) => {
              const persisted = source.attempts[attemptIndex];
              return (
                persisted === undefined ||
                persisted.attemptNumber !== attempt.attemptNumber ||
                persistedAttemptTrigger(attempt.trigger) !==
                  persisted.trigger ||
                persistedAttemptStatus(attempt.status) !== persisted.status ||
                persistedEffectCertainty(attempt.effectCertainty) !==
                  persisted.effectCertainty ||
                (attempt.errorCode ?? null) !== persisted.safeErrorCode ||
                (attempt.repairRequestId ?? null) !==
                  persisted.authorizedByRepairRequestId
              );
            })
          ) {
            throw new WorkflowRunRepositoryError('COMPLETION_INVALID');
          }
        }
      });
      for (const approval of run.approvalRequests) {
        const approvalStep = result.steps.find(
          (step) => step.stepId === approval.approvalStepId,
        );
        const gatedStep = result.steps.find(
          (step) => step.stepId === approval.gatedStepId,
        );
        const valid =
          approvalStep !== undefined &&
          gatedStep !== undefined &&
          (approval.status === WorkflowApprovalRequestStatus.APPROVED
            ? approvalStep.status === 'succeeded'
            : approval.status === WorkflowApprovalRequestStatus.REJECTED
              ? result.terminationCause === 'approval_rejected' &&
                approvalStep.status === 'cancelled' &&
                gatedStep.status === 'skipped'
              : approval.status === WorkflowApprovalRequestStatus.EXPIRED
                ? result.terminationCause === 'approval_expired' &&
                  approvalStep.status === 'timed_out' &&
                  gatedStep.status === 'skipped'
                : approval.status === WorkflowApprovalRequestStatus.CANCELLED
                  ? result.status === 'cancelled' &&
                    gatedStep.status === 'skipped'
                  : approval.status ===
                      WorkflowApprovalRequestStatus.INVALIDATED
                    ? result.status === 'interrupted' &&
                      gatedStep.status === 'skipped'
                    : false);
        if (!valid) {
          throw new WorkflowRunRepositoryError('COMPLETION_INVALID');
        }
      }
      if (result.outputs.length !== run.outputs.length) {
        throw new WorkflowRunRepositoryError('COMPLETION_INVALID');
      }
      result.outputs.forEach((output, index) => {
        const source = run.outputs[index];
        const expectedType =
          source?.outputType === WorkflowRunOutputType.STRING
            ? 'string'
            : 'boolean';
        if (
          source === undefined ||
          source.outputName !== output.outputName ||
          source.producerStepId !== output.producerStepId ||
          expectedType !== output.outputType ||
          (source.status === WorkflowRunOutputStatus.PRODUCED &&
            output.status !== 'produced')
        ) {
          throw new WorkflowRunRepositoryError('COMPLETION_INVALID');
        }
        const producerStep = result.steps[source.producerStepIndex];
        if (
          producerStep?.stepId !== source.producerStepId ||
          (output.status === 'produced') !==
            (producerStep.status === 'succeeded')
        ) {
          throw new WorkflowRunRepositoryError('COMPLETION_INVALID');
        }
      });
      for (const [index, step] of result.steps.entries()) {
        const source = run.steps[index]!;
        await transaction.workflowRunStep.update({
          where: { id: source.id },
          data: {
            status: persistedStepStatus(step.status),
            lastEngineStatus: step.status,
            startedAt:
              step.startedAt === undefined ? null : new Date(step.startedAt),
            finishedAt: new Date(step.finishedAt),
            durationMs: step.durationMs,
            errorCode: step.error?.code ?? null,
            skippedReason: step.skippedReason ?? null,
          },
        });
      }
      for (const [index, output] of result.outputs.entries()) {
        const source = run.outputs[index]!;
        await transaction.workflowRunOutput.update({
          where: { id: source.id },
          data: {
            status:
              output.status === 'produced'
                ? WorkflowRunOutputStatus.PRODUCED
                : WorkflowRunOutputStatus.NOT_PRODUCED,
            producedAt:
              output.status === 'produced'
                ? (source.producedAt ?? new Date(result.finishedAt))
                : null,
          },
        });
      }
      const updated = await transaction.workflowRun.update({
        where: { id: run.id },
        data: {
          status: persistedRunStatus(result.status),
          startedAt: new Date(result.startedAt),
          finishedAt: new Date(result.finishedAt),
          terminationCause: result.terminationCause,
          clientCompletionId: input.completion.clientCompletionId,
          completionDigest: input.completion.digest,
          finalResult: result as Prisma.InputJsonValue,
          leaseTokenHash: null,
          leaseExpiresAt: null,
        },
        include: runInclude,
      });
      return { run: toRecord(updated), idempotent: false };
    });
  }

  cancel(
    actorUserId: string,
    workflowRunId: string,
    now: Date,
  ): Promise<CompletionResult> {
    return this.runSerializable(async (transaction) => {
      await this.lockRun(transaction, workflowRunId);
      const run = await transaction.workflowRun.findUnique({
        where: { id: workflowRunId },
        include: {
          ...runInclude,
          workspace: {
            select: {
              organization: {
                select: {
                  members: {
                    where: { userId: actorUserId },
                    select: { role: true },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      });
      const role = run?.workspace.organization.members[0]?.role;
      if (run === null || run === undefined || role === undefined) {
        throw new WorkflowRunRepositoryError('RUN_NOT_FOUND');
      }
      if (!WRITER_ROLES.includes(role as (typeof WRITER_ROLES)[number])) {
        throw new WorkflowRunRepositoryError('RUN_FORBIDDEN');
      }
      if (terminal(run.status)) {
        return { run: toRecord(run), idempotent: true };
      }
      await transaction.workflowApprovalRequest.updateMany({
        where: {
          workflowRunId,
          status: WorkflowApprovalRequestStatus.PENDING,
        },
        data: {
          status: WorkflowApprovalRequestStatus.CANCELLED,
          resolvedAt: now,
        },
      });
      await transaction.workflowRepairRequest.updateMany({
        where: {
          workflowRunId,
          status: WorkflowRepairRequestStatus.PENDING,
        },
        data: {
          status: WorkflowRepairRequestStatus.CANCELLED,
          resolvedAt: now,
        },
      });
      if (run.status === WorkflowRunStatus.QUEUED) {
        await transaction.workflowRunStep.updateMany({
          where: { workflowRunId, status: WorkflowRunStepStatus.PENDING },
          data: {
            status: WorkflowRunStepStatus.SKIPPED,
            skippedReason: 'run_cancelled',
            finishedAt: now,
          },
        });
        const cancelled = await transaction.workflowRun.update({
          where: { id: workflowRunId },
          data: {
            status: WorkflowRunStatus.CANCELLED,
            cancelRequestedAt: now,
            cancelRequestedByUserId: actorUserId,
            finishedAt: now,
            terminationCause: 'run_cancelled',
          },
          include: runInclude,
        });
        return { run: toRecord(cancelled), idempotent: false };
      }
      const alreadyRequested =
        run.status === WorkflowRunStatus.CANCEL_REQUESTED;
      const updated = await transaction.workflowRun.update({
        where: { id: workflowRunId },
        data: {
          status: WorkflowRunStatus.CANCEL_REQUESTED,
          cancelRequestedAt: run.cancelRequestedAt ?? now,
          cancelRequestedByUserId: run.cancelRequestedByUserId ?? actorUserId,
        },
        include: runInclude,
      });
      return { run: toRecord(updated), idempotent: alreadyRequested };
    });
  }

  async getRun(
    actorUserId: string,
    workflowRunId: string,
    now: Date,
  ): Promise<{ access: WorkflowRunAccess; run: WorkflowRunRecord } | null> {
    await this.expireRunIfRequired(workflowRunId, now);
    const access = await this.resolveWorkflowRunAccess(
      actorUserId,
      workflowRunId,
    );
    if (access === null) {
      return null;
    }
    const row = await this.prisma.workflowRun.findUnique({
      where: { id: workflowRunId },
      include: runInclude,
    });
    return row === null ? null : { access, run: toRecord(row) };
  }

  async listRuns(
    actorUserId: string,
    workspaceId: string,
    now: Date,
  ): Promise<WorkflowRunListRecord | null> {
    const access = await this.resolveWorkspaceAccess(
      this.prisma,
      actorUserId,
      workspaceId,
    );
    if (access === null) {
      return null;
    }
    const expired = await this.prisma.workflowRun.findMany({
      where: {
        workspaceId,
        status: { in: [...ACTIVE_STATUSES] },
        leaseExpiresAt: { lte: now },
      },
      select: { id: true },
    });
    for (const run of expired) {
      await this.expireRunIfRequired(run.id, now);
    }
    const rows = await this.prisma.workflowRun.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 100,
      include: runInclude,
    });
    return { workspaceId, access, runs: rows.map(toRecord) };
  }

  private claimedRecord(
    row: {
      id: string;
      leaseExpiresAt: Date | null;
      definitionDigest: string;
      allowedOrigins: Prisma.JsonValue;
      executionOptions: Prisma.JsonValue;
      workflowVersion: { definition: Prisma.JsonValue };
      policyVersion: {
        id: string;
        revision: number;
        definition: Prisma.JsonValue;
        digest: string;
      } | null;
      policyDigest: string | null;
      policyEvaluation: Prisma.JsonValue | null;
      inputEnvelope: {
        schemaVersion: number;
        profile: string;
        contentEncryption: string;
        keyEncryption: string;
        preparationId: string;
        workflowRunId: string;
        keyId: string;
        expiresAt: Date;
        aad: string;
        iv: string;
        wrappedKey: string;
        ciphertext: string;
        ciphertextDigest: string;
        preparation: {
          variableManifest: Prisma.JsonValue;
          secretManifest: Prisma.JsonValue;
          aad: Prisma.JsonValue;
        };
      } | null;
    },
    idempotent: boolean,
  ): ClaimWorkflowRunResult {
    if (row.leaseExpiresAt === null) {
      throw new WorkflowRunRepositoryError('RUN_CONFLICT');
    }
    if (row.policyVersion === null || row.policyDigest === null) {
      throw new WorkflowRunRepositoryError('RUN_CONFLICT');
    }
    return {
      status: 'claimed',
      runId: row.id,
      workflow: WorkflowDefinitionSchema.parse(row.workflowVersion.definition),
      definitionDigest: row.definitionDigest,
      policy: {
        versionId: row.policyVersion.id,
        revision: row.policyVersion.revision,
        digest: row.policyDigest,
        definition: WorkspaceExecutionPolicyDefinitionSchema.parse(
          row.policyVersion.definition,
        ),
        evaluation: WorkflowPolicyEvaluationSchema.parse(row.policyEvaluation),
      },
      allowedOrigins: parseJsonArray(row.allowedOrigins),
      options: parseOptions(row.executionOptions),
      runtimeInput:
        row.inputEnvelope === null
          ? { kind: 'none' }
          : {
              kind: 'encrypted_envelope',
              envelope: SecureRunInputEnvelopeSchema.parse({
                schemaVersion: row.inputEnvelope.schemaVersion,
                profile: row.inputEnvelope.profile,
                contentEncryption: row.inputEnvelope.contentEncryption,
                keyEncryption: row.inputEnvelope.keyEncryption,
                preparationId: row.inputEnvelope.preparationId,
                workflowRunId: row.inputEnvelope.workflowRunId,
                keyId: row.inputEnvelope.keyId,
                expiresAt: row.inputEnvelope.expiresAt.toISOString(),
                aad: row.inputEnvelope.aad,
                iv: row.inputEnvelope.iv,
                wrappedKey: row.inputEnvelope.wrappedKey,
                ciphertext: row.inputEnvelope.ciphertext,
                ciphertextDigest: row.inputEnvelope.ciphertextDigest,
              }),
              aad: RunInputAdditionalAuthenticatedDataSchema.parse(
                row.inputEnvelope.preparation.aad,
              ),
              manifest: SecureRunInputManifestSchema.parse({
                schemaVersion: 1,
                variables: row.inputEnvelope.preparation.variableManifest,
                secrets: row.inputEnvelope.preparation.secretManifest,
              }),
            },
      leaseExpiresAt: row.leaseExpiresAt,
      idempotent,
    };
  }

  private requireLease(
    run: {
      runnerDeviceId: string;
      status: WorkflowRunStatus;
      leaseTokenHash: string | null;
      leaseExpiresAt: Date | null;
      runnerDevice?: {
        revokedAt: Date | null;
        credential: { revokedAt: Date | null } | null;
      };
    } | null,
    input: { runnerDeviceId: string; leaseTokenHash: string },
    now: Date,
  ): void {
    if (run === null) {
      throw new WorkflowRunRepositoryError('RUN_NOT_FOUND');
    }
    if (run.runnerDeviceId !== input.runnerDeviceId) {
      throw new WorkflowRunRepositoryError('RUNNER_MISMATCH');
    }
    if (
      run.runnerDevice?.revokedAt !== null &&
      run.runnerDevice?.revokedAt !== undefined
    ) {
      throw new WorkflowRunRepositoryError('RUNNER_REVOKED');
    }
    if (
      run.runnerDevice?.credential?.revokedAt !== null &&
      run.runnerDevice?.credential?.revokedAt !== undefined
    ) {
      throw new WorkflowRunRepositoryError('RUNNER_REVOKED');
    }
    if (
      !ACTIVE_STATUSES.includes(
        run.status as (typeof ACTIVE_STATUSES)[number],
      ) ||
      run.leaseTokenHash !== input.leaseTokenHash ||
      run.leaseExpiresAt === null
    ) {
      throw new WorkflowRunRepositoryError('LEASE_INVALID');
    }
    if (run.leaseExpiresAt.getTime() <= now.getTime()) {
      throw new WorkflowRunRepositoryError('LEASE_EXPIRED');
    }
  }

  private validEngineRunTransition(
    current: string | null,
    next: WorkflowEngineRunStatus,
  ): boolean {
    if (current === null) {
      return next === 'pending';
    }
    const parsed = current as WorkflowEngineRunStatus;
    return (
      validRunTransitions()[parsed] as readonly WorkflowEngineRunStatus[]
    ).includes(next);
  }

  private validEngineStepTransition(
    current: string | null,
    next: WorkflowEngineStepStatus,
  ): boolean {
    if (current === null) {
      return next === 'pending';
    }
    const parsed = current as WorkflowEngineStepStatus;
    return (
      validStepTransitions()[parsed] as readonly WorkflowEngineStepStatus[]
    ).includes(next);
  }

  private async expireRunIfRequired(runId: string, now: Date): Promise<void> {
    await this.runSerializable(async (transaction) => {
      await this.lockRun(transaction, runId);
      const run = await transaction.workflowRun.findUnique({
        where: { id: runId },
        select: { status: true, leaseExpiresAt: true },
      });
      if (
        run !== null &&
        ACTIVE_STATUSES.includes(
          run.status as (typeof ACTIVE_STATUSES)[number],
        ) &&
        run.leaseExpiresAt !== null &&
        run.leaseExpiresAt.getTime() <= now.getTime()
      ) {
        await this.interruptLockedRun(transaction, runId, now);
      }
    });
  }

  private async interruptLockedRun(
    transaction: Prisma.TransactionClient,
    runId: string,
    now: Date,
  ): Promise<void> {
    await transaction.workflowRunStep.updateMany({
      where: {
        workflowRunId: runId,
        status: {
          in: [
            WorkflowRunStepStatus.RUNNING,
            WorkflowRunStepStatus.WAITING_FOR_APPROVAL,
            WorkflowRunStepStatus.WAITING_FOR_REPAIR,
          ],
        },
      },
      data: {
        status: WorkflowRunStepStatus.INTERRUPTED,
        errorCode: 'LEASE_EXPIRED',
        finishedAt: now,
      },
    });
    await transaction.workflowApprovalRequest.updateMany({
      where: {
        workflowRunId: runId,
        status: WorkflowApprovalRequestStatus.PENDING,
      },
      data: {
        status: WorkflowApprovalRequestStatus.INVALIDATED,
        resolvedAt: now,
      },
    });
    await transaction.workflowRepairRequest.updateMany({
      where: {
        workflowRunId: runId,
        status: WorkflowRepairRequestStatus.PENDING,
      },
      data: {
        status: WorkflowRepairRequestStatus.INVALIDATED,
        resolvedAt: now,
      },
    });
    await transaction.workflowRunStepAttempt.updateMany({
      where: {
        workflowRunId: runId,
        status: WorkflowRunStepAttemptStatus.RUNNING,
      },
      data: {
        status: WorkflowRunStepAttemptStatus.INTERRUPTED,
        safeErrorCode: 'LEASE_EXPIRED',
        effectCertainty: WorkflowExecutionEffectCertainty.UNKNOWN,
        finishedAt: now,
      },
    });
    await transaction.workflowRunStep.updateMany({
      where: { workflowRunId: runId, status: WorkflowRunStepStatus.PENDING },
      data: {
        status: WorkflowRunStepStatus.SKIPPED,
        skippedReason: 'run_interrupted',
        finishedAt: now,
      },
    });
    await transaction.workflowRun.update({
      where: { id: runId },
      data: {
        status: WorkflowRunStatus.INTERRUPTED,
        terminationCause: 'lease_expired',
        finishedAt: now,
        leaseTokenHash: null,
        leaseExpiresAt: null,
      },
    });
  }

  private async lockRun(
    transaction: Prisma.TransactionClient,
    runId: string,
  ): Promise<void> {
    await transaction.$queryRaw`
      SELECT "id" FROM "workflow_runs" WHERE "id" = ${runId}::uuid FOR UPDATE
    `;
  }

  private async resolveWorkspaceAccess(
    client: Prisma.TransactionClient | PrismaClient,
    userId: string,
    workspaceId: string,
  ): Promise<WorkflowRunAccess | null> {
    const membership = await client.organizationMember.findFirst({
      where: {
        userId,
        organization: { workspaces: { some: { id: workspaceId } } },
      },
      select: { organizationId: true, role: true },
    });
    return membership === null
      ? null
      : {
          organizationId: membership.organizationId,
          userId,
          role: membership.role,
        };
  }

  private async runSerializable<Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
  ): Promise<Result> {
    for (let attempt = 0; attempt < SERIALIZATION_RETRY_COUNT; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error: unknown) {
        if (
          !isSerializationError(error) ||
          attempt === SERIALIZATION_RETRY_COUNT - 1
        ) {
          if (isSerializationError(error)) {
            throw new WorkflowRunRepositoryError('SERIALIZATION_FAILURE');
          }
          throw error;
        }
      }
    }
    throw new WorkflowRunRepositoryError('SERIALIZATION_FAILURE');
  }
}
