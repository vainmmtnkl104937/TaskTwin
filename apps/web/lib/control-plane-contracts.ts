import { WorkflowDefinitionSchema } from '@tasktwin/workflow-schema';
import { z } from 'zod';

const UuidSchema = z.string().uuid();
const IsoDateSchema = z.string().datetime({ offset: true });
const RoleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']);
const StatusSchema = z.enum(['draft', 'published', 'archived']);
const AccessSchema = z.strictObject({
  role: RoleSchema,
  canEdit: z.boolean(),
});

export const LoginResponseSchema = z.strictObject({
  user: z.strictObject({
    id: UuidSchema,
    email: z.string().email(),
    displayName: z.string().min(1),
    isActive: z.boolean(),
    createdAt: IsoDateSchema,
    updatedAt: IsoDateSchema,
  }),
  accessToken: z.string().min(1),
});

export const WorkspaceListResponseSchema = z.strictObject({
  workspaces: z.array(
    z.strictObject({
      id: UuidSchema,
      organizationId: UuidSchema,
      name: z.string().min(1),
      slug: z.string().min(1),
      createdAt: IsoDateSchema,
      updatedAt: IsoDateSchema,
    }),
  ),
});

const WorkflowVersionSchema = z.strictObject({
  id: UuidSchema,
  workflowId: z.string().min(1),
  version: z.number().int().positive(),
  revision: z.number().int().positive(),
  status: StatusSchema,
  schemaVersion: z.literal(1),
  definition: WorkflowDefinitionSchema,
  updatedAt: IsoDateSchema,
});

export const WorkspaceWorkflowListResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workspaceId: UuidSchema,
  access: AccessSchema,
  workflows: z.array(
    z.strictObject({
      id: z.string().min(1),
      name: z.string().min(1),
      description: z.string().nullable(),
      latestVersionId: UuidSchema,
      version: z.number().int().positive(),
      revision: z.number().int().positive(),
      status: StatusSchema,
      updatedAt: IsoDateSchema,
    }),
  ),
});

export const WorkflowVersionDetailResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workspaceId: UuidSchema,
  access: AccessSchema,
  workflowVersion: WorkflowVersionSchema,
  locatorMetadata: z.array(
    z.strictObject({
      stepId: z.string().min(1),
      confidence: z.enum(['high', 'medium', 'low']),
      provenance: z.string().min(1).max(64),
    }),
  ),
});

export const WorkflowConflictResponseSchema = z
  .object({
    code: z.literal('WORKFLOW_DRAFT_REVISION_CONFLICT'),
    currentRevision: z.number().int().positive().optional(),
  })
  .passthrough();

export const WorkflowDraftValidationErrorResponseSchema = z.strictObject({
  code: z.literal('WORKFLOW_INPUT_VALIDATION_FAILED'),
  message: z.string().min(1).max(240),
  issues: z.array(
    z.strictObject({
      code: z.string().min(1).max(80),
      message: z.string().min(1).max(240),
      path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
      stepId: z.string().min(1).optional(),
      stepIndex: z.number().int().nonnegative().optional(),
      variableName: z.string().min(1).optional(),
    }),
  ),
});

export type WorkspaceListResponse = z.infer<typeof WorkspaceListResponseSchema>;
export type WorkspaceWorkflowListResponse = z.infer<
  typeof WorkspaceWorkflowListResponseSchema
>;
export type WorkflowVersionDetailResponse = z.infer<
  typeof WorkflowVersionDetailResponseSchema
>;
