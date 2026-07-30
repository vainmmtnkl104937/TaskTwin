import type { OrganizationRole, Prisma } from '../generated/prisma/client.js';
import type { WorkflowLifecycleStatus } from '@tasktwin/workflow-schema';

export interface WorkflowAccessRecord {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
}

export interface WorkflowListItemRecord {
  id: string;
  name: string;
  description: string | null;
  latestVersionId: string;
  version: number;
  revision: number;
  status: WorkflowLifecycleStatus;
  updatedAt: Date;
}

export interface WorkspaceWorkflowListRecord {
  workspaceId: string;
  access: WorkflowAccessRecord;
  workflows: WorkflowListItemRecord[];
}

export interface WorkflowVersionDetailRecord {
  id: string;
  workflowId: string;
  workspaceId: string;
  version: number;
  revision: number;
  status: WorkflowLifecycleStatus;
  schemaVersion: number;
  definition: Prisma.JsonValue;
  createdFromVersionId: string | null;
  clientCreationId: string | null;
  publishedAt: Date | null;
  publishedById: string | null;
  archivedAt: Date | null;
  archivedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  conversionReport: Prisma.JsonValue | null;
  access: WorkflowAccessRecord;
}

export interface UpdateWorkflowDraftResult {
  workflowVersion: WorkflowVersionDetailRecord;
}
