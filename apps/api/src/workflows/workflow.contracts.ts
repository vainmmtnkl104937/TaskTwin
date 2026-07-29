import { WorkflowDefinitionSchema } from '@tasktwin/workflow-schema';
import { z } from 'zod';

const UuidSchema = z.string().uuid();
const OrganizationRoleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']);
const WorkflowStatusSchema = z.enum(['draft', 'published', 'archived']);
const AccessSchema = z.strictObject({
  role: OrganizationRoleSchema,
  canEdit: z.boolean(),
});

export const UpdateWorkflowDraftRequestSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  definition: WorkflowDefinitionSchema,
});

export const WorkflowListItemResponseSchema = z.strictObject({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().nullable(),
  latestVersionId: UuidSchema,
  version: z.number().int().positive(),
  revision: z.number().int().positive(),
  status: WorkflowStatusSchema,
  updatedAt: z.string().datetime({ offset: true }),
});

export const WorkspaceWorkflowListResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workspaceId: UuidSchema,
  access: AccessSchema,
  workflows: z.array(WorkflowListItemResponseSchema),
});

export const SafeLocatorMetadataSchema = z.strictObject({
  stepId: z.string().trim().min(1),
  confidence: z.enum(['high', 'medium', 'low']),
  provenance: z.string().trim().min(1).max(64),
});

export const WorkflowVersionResponseSchema = z.strictObject({
  id: UuidSchema,
  workflowId: z.string().trim().min(1),
  version: z.number().int().positive(),
  revision: z.number().int().positive(),
  status: WorkflowStatusSchema,
  schemaVersion: z.literal(1),
  definition: WorkflowDefinitionSchema,
  updatedAt: z.string().datetime({ offset: true }),
});

export const WorkflowVersionDetailResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workspaceId: UuidSchema,
  access: AccessSchema,
  workflowVersion: WorkflowVersionResponseSchema,
  locatorMetadata: z.array(SafeLocatorMetadataSchema),
});

export type UpdateWorkflowDraftRequest = z.infer<
  typeof UpdateWorkflowDraftRequestSchema
>;
export type WorkspaceWorkflowListResponse = z.infer<
  typeof WorkspaceWorkflowListResponseSchema
>;
export type WorkflowVersionDetailResponse = z.infer<
  typeof WorkflowVersionDetailResponseSchema
>;
