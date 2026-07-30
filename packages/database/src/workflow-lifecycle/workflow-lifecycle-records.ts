import type { PublishReadinessReport } from '@tasktwin/workflow-lifecycle';
import type { WorkflowLifecycleStatus } from '@tasktwin/workflow-schema';

import type {
  WorkflowAccessRecord,
  WorkflowVersionDetailRecord,
} from '../workflow-draft/workflow-draft-records.js';

export interface WorkflowVersionHistoryItemRecord {
  id: string;
  workflowId: string;
  version: number;
  revision: number;
  status: WorkflowLifecycleStatus;
  schemaVersion: number;
  createdFromVersionId: string | null;
  publishedAt: Date | null;
  publishedById: string | null;
  archivedAt: Date | null;
  archivedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowVersionHistoryRecord {
  workflowId: string;
  workspaceId: string;
  access: WorkflowAccessRecord;
  versions: WorkflowVersionHistoryItemRecord[];
}

export interface WorkflowLifecycleActionResult {
  workflowVersion: WorkflowVersionDetailRecord;
  readiness: PublishReadinessReport | null;
  idempotent: boolean;
}

export interface CreateWorkflowVersionResult {
  workflowVersion: WorkflowVersionDetailRecord;
  idempotent: boolean;
}
