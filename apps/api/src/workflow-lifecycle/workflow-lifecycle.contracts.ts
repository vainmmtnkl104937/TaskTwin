import { PublishReadinessReportSchema } from '@tasktwin/workflow-lifecycle';
import { WorkflowLifecycleStatusSchema } from '@tasktwin/workflow-schema';
import { z } from 'zod';

import { WorkflowVersionDetailResponseSchema } from '../workflows/workflow.contracts.js';

const UuidSchema = z.string().uuid();
const IsoDateSchema = z.string().datetime({ offset: true });
const OrganizationRoleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']);

export const ExpectedRevisionRequestSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
});

export const EmptyLifecycleRequestSchema = z.strictObject({});

export const CreateWorkflowVersionRequestSchema = z.strictObject({
  clientCreationId: UuidSchema,
  sourceVersionId: UuidSchema,
});

export const WorkflowLifecycleActionResponseSchema =
  WorkflowVersionDetailResponseSchema.extend({
    idempotent: z.boolean(),
  });

export const WorkflowVersionHistoryItemResponseSchema = z.strictObject({
  id: UuidSchema,
  workflowId: z.string().trim().min(1).max(256),
  version: z.number().int().positive(),
  revision: z.number().int().positive(),
  status: WorkflowLifecycleStatusSchema,
  schemaVersion: z.literal(1),
  createdFromVersionId: UuidSchema.nullable(),
  publishedAt: IsoDateSchema.nullable(),
  publishedById: UuidSchema.nullable(),
  archivedAt: IsoDateSchema.nullable(),
  archivedById: UuidSchema.nullable(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});

export const WorkflowVersionHistoryResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workflowId: z.string().trim().min(1).max(256),
  workspaceId: UuidSchema,
  access: z.strictObject({
    role: OrganizationRoleSchema,
    canEdit: z.boolean(),
    canPublish: z.boolean(),
  }),
  versions: z.array(WorkflowVersionHistoryItemResponseSchema),
});

export const WorkflowLifecycleErrorResponseSchema = z.strictObject({
  code: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(240),
  currentRevision: z.number().int().positive().optional(),
  readiness: PublishReadinessReportSchema.optional(),
});

export type ExpectedRevisionRequest = z.infer<
  typeof ExpectedRevisionRequestSchema
>;
export type CreateWorkflowVersionRequest = z.infer<
  typeof CreateWorkflowVersionRequestSchema
>;
export type WorkflowLifecycleActionResponse = z.infer<
  typeof WorkflowLifecycleActionResponseSchema
>;
export type WorkflowVersionHistoryResponse = z.infer<
  typeof WorkflowVersionHistoryResponseSchema
>;
