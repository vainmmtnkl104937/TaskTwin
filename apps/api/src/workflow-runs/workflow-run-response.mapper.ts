import {
  CreateWorkflowRunResponseSchema,
  WorkflowRunCancellationResponseSchema,
  WorkflowRunDetailResponseSchema,
  WorkflowRunListResponseSchema,
} from '@tasktwin/run-protocol';
import type {
  CompletionResult,
  CreateWorkflowRunResult,
  WorkflowRunAccess,
  WorkflowRunListRecord,
  WorkflowRunListItemRecord,
  WorkflowRunRecord,
} from '@tasktwin/database';

const WRITERS = new Set(['OWNER', 'ADMIN', 'MEMBER']);

export function safeRun(run: WorkflowRunRecord) {
  return {
    ...safeRunMetadata(run),
    steps: run.steps.map((step) => ({
      ...step,
      startedAt: step.startedAt?.toISOString() ?? null,
      finishedAt: step.finishedAt?.toISOString() ?? null,
    })),
    outputs: run.outputs.map((output) => ({
      ...output,
      producedAt: output.producedAt?.toISOString() ?? null,
    })),
  };
}

function safeRunMetadata(run: WorkflowRunRecord | WorkflowRunListItemRecord) {
  return {
    id: run.id,
    workspaceId: run.workspaceId,
    workflowId: run.workflowId,
    workflowVersionId: run.workflowVersionId,
    workflowVersion: run.workflowVersion,
    runnerDeviceId: run.runnerDeviceId,
    createdByUserId: run.createdByUserId,
    clientRunId: run.clientRunId,
    status: run.status,
    definitionDigest: run.definitionDigest,
    policyVersionId: run.policyVersionId,
    policyDigest: run.policyDigest,
    policyDecision: run.policyDecision,
    policyHighestRisk: run.policyHighestRisk,
    stepCount: 'stepCount' in run ? run.stepCount : run.steps.length,
    lastProgressSequence: run.lastProgressSequence,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    claimedAt: run.claimedAt?.toISOString() ?? null,
    startedAt: run.startedAt?.toISOString() ?? null,
    cancelRequestedAt: run.cancelRequestedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    terminationCause: run.terminationCause,
  };
}

function access(access: WorkflowRunAccess) {
  const writable = WRITERS.has(access.role);
  return { role: access.role, canCreate: writable, canCancel: writable };
}

export function createResponse(result: CreateWorkflowRunResult) {
  return CreateWorkflowRunResponseSchema.parse({
    schemaVersion: 1,
    idempotent: result.idempotent,
    run: safeRun(result.run),
  });
}

export function cancellationResponse(result: CompletionResult) {
  return WorkflowRunCancellationResponseSchema.parse({
    schemaVersion: 1,
    idempotent: result.idempotent,
    run: safeRun(result.run),
  });
}

export function listResponse(
  result: WorkflowRunListRecord,
  nextCursor: string | null,
) {
  return WorkflowRunListResponseSchema.parse({
    schemaVersion: 1,
    workspaceId: result.workspaceId,
    access: access(result.access),
    runs: result.runs.map(safeRunMetadata),
    nextCursor,
  });
}

export function detailResponse(input: {
  access: WorkflowRunAccess;
  run: WorkflowRunRecord;
}) {
  const mapped = access(input.access);
  return WorkflowRunDetailResponseSchema.parse({
    schemaVersion: 1,
    access: { role: mapped.role, canCancel: mapped.canCancel },
    run: safeRun(input.run),
  });
}
