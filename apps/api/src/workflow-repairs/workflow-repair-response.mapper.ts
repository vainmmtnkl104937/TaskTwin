import type { WorkflowRepairRecord } from '@tasktwin/database';
import {
  SafeRepairRequestSchema,
  type SafeRepairRequest,
} from '@tasktwin/workflow-recovery';

export function safeRepair(record: WorkflowRepairRecord): SafeRepairRequest {
  return SafeRepairRequestSchema.parse({
    id: record.id,
    workspaceId: record.workspaceId,
    workflowRunId: record.workflowRunId,
    workflowId: record.workflowId,
    workflowName: record.workflowName,
    workflowVersion: record.workflowVersion,
    runner: record.runner,
    step: record.step,
    attemptNumber: record.attemptNumber,
    safeErrorCode: record.safeErrorCode,
    effectCertainty: record.effectCertainty,
    retryAllowed: record.retryAllowed,
    status: record.status,
    requestedAt: record.requestedAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    resolvedAt: record.resolvedAt?.toISOString() ?? null,
  });
}
