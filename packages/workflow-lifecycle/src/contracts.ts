import {
  WorkflowDefinitionSchema,
  WorkflowLifecycleStatusSchema,
} from '@tasktwin/workflow-schema';
import { z } from 'zod';

export const WORKFLOW_LIFECYCLE_SCHEMA_VERSION = 1;
export const MAX_LIFECYCLE_ISSUES = 2_000;

export const WorkflowLifecycleTransitionSchema = z.strictObject({
  from: WorkflowLifecycleStatusSchema,
  to: WorkflowLifecycleStatusSchema,
});

export const WorkflowLifecycleErrorCodeSchema = z.enum([
  'INVALID_LIFECYCLE_TRANSITION',
  'INVALID_CLONE_INPUT',
  'SOURCE_VERSION_NOT_CLONEABLE',
  'INVALID_NEXT_VERSION',
]);

export const WorkflowLifecycleErrorSchema = z.strictObject({
  code: WorkflowLifecycleErrorCodeSchema,
  message: z.string().trim().min(1).max(200),
});

export const WorkflowLifecycleTransitionResultSchema = z.discriminatedUnion(
  'ok',
  [
    z.strictObject({
      ok: z.literal(true),
      transition: WorkflowLifecycleTransitionSchema,
    }),
    z.strictObject({
      ok: z.literal(false),
      error: WorkflowLifecycleErrorSchema,
    }),
  ],
);

export const PublishReadinessIssueCodeSchema = z.enum([
  'UNSUPPORTED_WORKFLOW_SCHEMA_VERSION',
  'INVALID_WORKFLOW_DEFINITION',
  'WORKFLOW_STEPS_REQUIRED',
  'DUPLICATE_STEP_ID',
  'DUPLICATE_VARIABLE_NAME',
  'UNKNOWN_VARIABLE_REFERENCE',
  'INCOMPATIBLE_VARIABLE_TYPE',
  'INCOMPATIBLE_LITERAL',
  'SECRET_SOURCE_NOT_ALLOWED',
  'UNSAFE_SECRET_REFERENCE',
  'UNUSED_VARIABLE',
  'INVALID_VERIFICATION',
  'OUTCOME_VERIFICATION_MISSING',
]);

export const PublishReadinessIssueSchema = z.strictObject({
  code: PublishReadinessIssueCodeSchema,
  severity: z.enum(['blocking', 'warning']),
  message: z.string().trim().min(1).max(240),
  path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
  stepId: z.string().trim().min(1).optional(),
  stepIndex: z.number().int().nonnegative().optional(),
  variableName: z.string().trim().min(1).optional(),
});

export const PublishReadinessSummarySchema = z.strictObject({
  blockingCount: z.number().int().nonnegative().max(MAX_LIFECYCLE_ISSUES),
  warningCount: z.number().int().nonnegative().max(MAX_LIFECYCLE_ISSUES),
  issueCount: z.number().int().nonnegative().max(MAX_LIFECYCLE_ISSUES),
  stepCount: z.number().int().nonnegative(),
  variableCount: z.number().int().nonnegative(),
  secretRequirementCount: z.number().int().nonnegative(),
});

export const PublishReadinessReportSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_LIFECYCLE_SCHEMA_VERSION),
  workflowId: z.string(),
  workflowVersion: z.number().int().nonnegative(),
  ready: z.boolean(),
  issues: z.array(PublishReadinessIssueSchema).max(MAX_LIFECYCLE_ISSUES),
  summary: PublishReadinessSummarySchema,
});

export const CreateDraftVersionCloneInputSchema = z.strictObject({
  sourceDefinition: WorkflowDefinitionSchema,
  sourceStatus: WorkflowLifecycleStatusSchema,
  nextVersion: z.number().int().positive(),
  createdAt: z.string().datetime({ offset: true }),
});

export const DraftVersionMetadataSchema = z.strictObject({
  version: z.number().int().positive(),
  revision: z.literal(1),
  status: z.literal('draft'),
  createdAt: z.string().datetime({ offset: true }),
});

export const CreateDraftVersionCloneResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    definition: WorkflowDefinitionSchema,
    metadata: DraftVersionMetadataSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    error: WorkflowLifecycleErrorSchema,
  }),
]);

export const SafeWorkflowLifecycleSummarySchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_LIFECYCLE_SCHEMA_VERSION),
  workflowId: z.string().trim().min(1),
  workflowVersion: z.number().int().positive(),
  revision: z.number().int().positive(),
  status: WorkflowLifecycleStatusSchema,
  readiness: PublishReadinessSummarySchema,
});

export type WorkflowLifecycleTransition = z.infer<
  typeof WorkflowLifecycleTransitionSchema
>;
export type WorkflowLifecycleErrorCode = z.infer<
  typeof WorkflowLifecycleErrorCodeSchema
>;
export type WorkflowLifecycleError = z.infer<
  typeof WorkflowLifecycleErrorSchema
>;
export type WorkflowLifecycleTransitionResult = z.infer<
  typeof WorkflowLifecycleTransitionResultSchema
>;
export type PublishReadinessIssueCode = z.infer<
  typeof PublishReadinessIssueCodeSchema
>;
export type PublishReadinessIssue = z.infer<typeof PublishReadinessIssueSchema>;
export type PublishReadinessSummary = z.infer<
  typeof PublishReadinessSummarySchema
>;
export type PublishReadinessReport = z.infer<
  typeof PublishReadinessReportSchema
>;
export type CreateDraftVersionCloneInput = z.infer<
  typeof CreateDraftVersionCloneInputSchema
>;
export type DraftVersionMetadata = z.infer<typeof DraftVersionMetadataSchema>;
export type CreateDraftVersionCloneResult = z.infer<
  typeof CreateDraftVersionCloneResultSchema
>;
export type SafeWorkflowLifecycleSummary = z.infer<
  typeof SafeWorkflowLifecycleSummarySchema
>;
