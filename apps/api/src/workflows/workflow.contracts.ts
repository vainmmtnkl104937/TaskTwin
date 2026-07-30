import { WorkflowDefinitionSchema } from '@tasktwin/workflow-schema';
import { WorkflowLifecycleStatusSchema } from '@tasktwin/workflow-schema';
import { PublishReadinessReportSchema } from '@tasktwin/workflow-lifecycle';
import { z } from 'zod';

const UuidSchema = z.string().uuid();
const OrganizationRoleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']);
const WorkflowStatusSchema = WorkflowLifecycleStatusSchema;
const AccessSchema = z.strictObject({
  role: OrganizationRoleSchema,
  canEdit: z.boolean(),
});

export const UpdateWorkflowDraftRequestSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  definition: WorkflowDefinitionSchema,
});

export const WorkflowDraftValidationIssueSchema = z.strictObject({
  code: z.string().trim().min(1).max(80),
  message: z.string().trim().min(1).max(240),
  path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
  stepId: z.string().trim().min(1).optional(),
  stepIndex: z.number().int().nonnegative().optional(),
  variableName: z.string().trim().min(1).optional(),
});

export const WorkflowDraftValidationErrorResponseSchema = z.strictObject({
  code: z.literal('WORKFLOW_INPUT_VALIDATION_FAILED'),
  message: z.string().trim().min(1).max(240),
  issues: z.array(WorkflowDraftValidationIssueSchema).min(1),
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
  createdFromVersionId: UuidSchema.nullable(),
  publishedAt: z.string().datetime({ offset: true }).nullable(),
  publishedById: UuidSchema.nullable(),
  archivedAt: z.string().datetime({ offset: true }).nullable(),
  archivedById: UuidSchema.nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const WorkflowVersionDetailResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workspaceId: UuidSchema,
  access: AccessSchema,
  workflowVersion: WorkflowVersionResponseSchema,
  locatorMetadata: z.array(SafeLocatorMetadataSchema),
  publishReadiness: PublishReadinessReportSchema,
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
export type WorkflowDraftValidationErrorResponse = z.infer<
  typeof WorkflowDraftValidationErrorResponseSchema
>;
