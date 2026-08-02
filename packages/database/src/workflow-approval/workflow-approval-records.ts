import type { ApprovalRequestStatus } from '@tasktwin/workflow-approval';
import type { ApprovalRiskLevel } from '@tasktwin/workflow-schema';
import type { OrganizationRole } from '../generated/prisma/client.js';

export interface WorkflowApprovalAccess {
  userId: string;
  organizationId: string;
  workspaceId: string;
  role: OrganizationRole;
}

export interface WorkflowApprovalRecord {
  id: string;
  workspaceId: string;
  workflowRunId: string;
  workflowId: string;
  workflowName: string;
  workflowVersion: number;
  approvalStep: { id: string; name: string; message: string };
  gatedStep: { id: string; name: string; type: string };
  riskLevel: ApprovalRiskLevel;
  status: ApprovalRequestStatus;
  requestedAt: Date;
  expiresAt: Date;
  resolvedAt: Date | null;
}

export interface WorkflowApprovalDecisionResult {
  idempotent: boolean;
  record: WorkflowApprovalRecord;
}
