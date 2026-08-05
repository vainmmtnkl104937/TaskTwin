import { WorkspaceExecutionPolicyDefinitionSchema } from '@tasktwin/workflow-policy';
import { z } from 'zod';

const UuidSchema = z.string().uuid();
const IsoDateSchema = z.string().datetime({ offset: true });
const RoleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']);

export const CreateExecutionPolicyVersionRequestSchema = z.strictObject({
  clientVersionId: UuidSchema,
  expectedActiveRevision: z.number().int().positive(),
  definition: WorkspaceExecutionPolicyDefinitionSchema,
});

export const SafeExecutionPolicyVersionSchema = z.strictObject({
  id: UuidSchema,
  workspaceId: UuidSchema,
  revision: z.number().int().positive(),
  status: z.enum(['ACTIVE', 'ARCHIVED']),
  definition: WorkspaceExecutionPolicyDefinitionSchema,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  clientVersionId: UuidSchema,
  createdByUserId: UuidSchema,
  activatedAt: IsoDateSchema,
  archivedAt: IsoDateSchema.nullable(),
  createdAt: IsoDateSchema,
});

const PolicyAccessSchema = z.strictObject({
  role: RoleSchema,
  canEdit: z.boolean(),
});

export const ActiveExecutionPolicyResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workspaceId: UuidSchema,
  access: PolicyAccessSchema,
  active: SafeExecutionPolicyVersionSchema,
});

export const ExecutionPolicyVersionListResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workspaceId: UuidSchema,
  access: PolicyAccessSchema,
  versions: z.array(SafeExecutionPolicyVersionSchema).max(1_000),
});

export const CreateExecutionPolicyVersionResponseSchema =
  ActiveExecutionPolicyResponseSchema.extend({ idempotent: z.boolean() });

export type CreateExecutionPolicyVersionRequest = z.infer<
  typeof CreateExecutionPolicyVersionRequestSchema
>;
export type ActiveExecutionPolicyResponse = z.infer<
  typeof ActiveExecutionPolicyResponseSchema
>;
export type ExecutionPolicyVersionListResponse = z.infer<
  typeof ExecutionPolicyVersionListResponseSchema
>;
export type CreateExecutionPolicyVersionResponse = z.infer<
  typeof CreateExecutionPolicyVersionResponseSchema
>;
