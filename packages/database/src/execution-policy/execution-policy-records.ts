import type { OrganizationRole } from '../generated/prisma/client.js';
import type { WorkspaceExecutionPolicyDefinition } from '@tasktwin/workflow-policy';

export interface ExecutionPolicyVersionRecord {
  id: string;
  workspaceId: string;
  revision: number;
  status: 'ACTIVE' | 'ARCHIVED';
  definition: WorkspaceExecutionPolicyDefinition;
  digest: string;
  clientVersionId: string;
  createdByUserId: string;
  activatedAt: Date;
  archivedAt: Date | null;
  createdAt: Date;
}

export interface WorkspaceExecutionPolicyRecord {
  workspaceId: string;
  organizationId: string;
  role: OrganizationRole;
  active: ExecutionPolicyVersionRecord;
}

export interface ExecutionPolicyVersionListRecord {
  workspaceId: string;
  organizationId: string;
  role: OrganizationRole;
  versions: ExecutionPolicyVersionRecord[];
}
