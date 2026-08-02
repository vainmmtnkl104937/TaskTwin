import {
  SafeApprovalRequestSchema,
  type SafeApprovalRequest,
} from '@tasktwin/workflow-approval';
import type { WorkflowApprovalRecord } from '@tasktwin/database';

export function safeApproval(
  record: WorkflowApprovalRecord,
): SafeApprovalRequest {
  return SafeApprovalRequestSchema.parse({
    ...record,
    requestedAt: record.requestedAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    resolvedAt: record.resolvedAt?.toISOString() ?? null,
  });
}
