import type { OrganizationRole, Prisma } from '../generated/prisma/client.js';

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
  status: 'draft' | 'published' | 'archived';
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
  status: 'draft' | 'published' | 'archived';
  schemaVersion: number;
  definition: Prisma.JsonValue;
  updatedAt: Date;
  conversionReport: Prisma.JsonValue | null;
  access: WorkflowAccessRecord;
}

export interface UpdateWorkflowDraftResult {
  workflowVersion: WorkflowVersionDetailRecord;
}
