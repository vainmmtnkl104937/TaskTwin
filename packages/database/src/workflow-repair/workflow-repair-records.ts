import type {
  ExecutionEffectCertainty,
  RepairRequestStatus,
} from '@tasktwin/workflow-recovery';
import type { OrganizationRole } from '../generated/prisma/client.js';

export interface WorkflowRepairAccess {
  userId: string;
  organizationId: string;
  workspaceId: string;
  role: OrganizationRole;
}

export interface WorkflowRepairRecord {
  id: string;
  workspaceId: string;
  workflowRunId: string;
  workflowId: string;
  workflowName: string;
  workflowVersion: number;
  runner: { id: string; name: string };
  step: { id: string; index: number; name: string; type: string };
  attemptNumber: number;
  safeErrorCode: string;
  effectCertainty: ExecutionEffectCertainty;
  retryAllowed: boolean;
  status: RepairRequestStatus;
  requestedAt: Date;
  expiresAt: Date;
  resolvedAt: Date | null;
}

export interface WorkflowRepairDecisionResult {
  idempotent: boolean;
  record: WorkflowRepairRecord;
}
