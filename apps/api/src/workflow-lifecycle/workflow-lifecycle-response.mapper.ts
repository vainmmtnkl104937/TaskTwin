import type {
  WorkflowLifecycleActionResult,
  WorkflowVersionHistoryRecord,
} from '@tasktwin/database';

import { toWorkflowVersionDetailResponse } from '../workflows/workflow-response.mapper.js';
import {
  WorkflowLifecycleActionResponseSchema,
  WorkflowVersionHistoryResponseSchema,
  type WorkflowLifecycleActionResponse,
  type WorkflowVersionHistoryResponse,
} from './workflow-lifecycle.contracts.js';

const WRITER_ROLES = new Set(['OWNER', 'ADMIN', 'MEMBER']);
const PUBLISHER_ROLES = new Set(['OWNER', 'ADMIN']);

export function toWorkflowLifecycleActionResponse(
  result: WorkflowLifecycleActionResult,
): WorkflowLifecycleActionResponse {
  return WorkflowLifecycleActionResponseSchema.parse({
    ...toWorkflowVersionDetailResponse(result.workflowVersion),
    idempotent: result.idempotent,
  });
}

export function toWorkflowVersionHistoryResponse(
  record: WorkflowVersionHistoryRecord,
): WorkflowVersionHistoryResponse {
  return WorkflowVersionHistoryResponseSchema.parse({
    schemaVersion: 1,
    workflowId: record.workflowId,
    workspaceId: record.workspaceId,
    access: {
      role: record.access.role,
      canEdit: WRITER_ROLES.has(record.access.role),
      canPublish: PUBLISHER_ROLES.has(record.access.role),
    },
    versions: record.versions.map((version) => ({
      ...version,
      publishedAt: version.publishedAt?.toISOString() ?? null,
      archivedAt: version.archivedAt?.toISOString() ?? null,
      createdAt: version.createdAt.toISOString(),
      updatedAt: version.updatedAt.toISOString(),
    })),
  });
}
