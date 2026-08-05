import type {
  ExecutionPolicyVersionListRecord,
  ExecutionPolicyVersionRecord,
  WorkspaceExecutionPolicyRecord,
} from '@tasktwin/database';

import {
  ActiveExecutionPolicyResponseSchema,
  CreateExecutionPolicyVersionResponseSchema,
  ExecutionPolicyVersionListResponseSchema,
  type ActiveExecutionPolicyResponse,
  type CreateExecutionPolicyVersionResponse,
  type ExecutionPolicyVersionListResponse,
} from './execution-policy.contracts.js';

function canEdit(role: string): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

function version(record: ExecutionPolicyVersionRecord) {
  return {
    ...record,
    activatedAt: record.activatedAt.toISOString(),
    archivedAt: record.archivedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  };
}

export function toActiveExecutionPolicyResponse(
  record: WorkspaceExecutionPolicyRecord,
): ActiveExecutionPolicyResponse {
  return ActiveExecutionPolicyResponseSchema.parse({
    schemaVersion: 1,
    workspaceId: record.workspaceId,
    access: { role: record.role, canEdit: canEdit(record.role) },
    active: version(record.active),
  });
}

export function toExecutionPolicyVersionListResponse(
  record: ExecutionPolicyVersionListRecord,
): ExecutionPolicyVersionListResponse {
  return ExecutionPolicyVersionListResponseSchema.parse({
    schemaVersion: 1,
    workspaceId: record.workspaceId,
    access: { role: record.role, canEdit: canEdit(record.role) },
    versions: record.versions.map(version),
  });
}

export function toCreateExecutionPolicyVersionResponse(
  record: WorkspaceExecutionPolicyRecord,
  idempotent: boolean,
): CreateExecutionPolicyVersionResponse {
  return CreateExecutionPolicyVersionResponseSchema.parse({
    ...toActiveExecutionPolicyResponse(record),
    idempotent,
  });
}
