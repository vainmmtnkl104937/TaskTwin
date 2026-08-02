import { IdentifierSchema } from '@tasktwin/workflow-schema';
import { ValueSourceTargetSchema } from '@tasktwin/workflow-inputs';
import { z } from 'zod';

export const WORKFLOW_EXTRACTION_SCHEMA_VERSION = 1 as const;

export const WorkflowOutputTypeSchema = z.enum(['string', 'boolean']);
export const WorkflowOutputRetentionSchema = z.literal('ephemeral');
export const WorkflowOutputStatusSchema = z.enum(['produced', 'not_produced']);

export const WorkflowOutputDefinitionSchema = z.strictObject({
  name: IdentifierSchema,
  label: z.string().trim().min(1).max(120).optional(),
  valueType: WorkflowOutputTypeSchema,
  retention: WorkflowOutputRetentionSchema,
  producerStepId: z.string().trim().min(1).max(256),
  producerStepIndex: z.number().int().nonnegative(),
});

export const WorkflowOutputUsageSchema = z.strictObject({
  outputName: IdentifierSchema,
  consumerStepId: z.string().trim().min(1).max(256),
  consumerStepIndex: z.number().int().nonnegative(),
  target: ValueSourceTargetSchema,
  path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
});

export const ExtractionIssueCodeSchema = z.enum([
  'INVALID_WORKFLOW_DEFINITION',
  'INVALID_EXTRACT_STEP',
  'UNSUPPORTED_EXTRACTION_SOURCE',
  'DUPLICATE_OUTPUT_NAME',
  'UNKNOWN_OUTPUT_REFERENCE',
  'OUTPUT_REFERENCE_BEFORE_PRODUCER',
  'OUTPUT_SELF_REFERENCE',
  'OUTPUT_TYPE_INCOMPATIBLE',
  'OUTPUT_NAVIGATE_FORBIDDEN',
  'PASSWORD_EXTRACTION_FORBIDDEN',
  'UNUSED_OUTPUT',
]);

export const ExtractionAnalysisIssueSchema = z.strictObject({
  code: ExtractionIssueCodeSchema,
  severity: z.enum(['blocking', 'warning']),
  message: z.string().trim().min(1).max(240),
  path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
  stepId: z.string().trim().min(1).max(256).optional(),
  stepIndex: z.number().int().nonnegative().optional(),
  outputName: IdentifierSchema.optional(),
});

export const WorkflowExtractionAnalysisSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_EXTRACTION_SCHEMA_VERSION),
  outputs: z.array(WorkflowOutputDefinitionSchema),
  usages: z.array(WorkflowOutputUsageSchema),
  issues: z.array(ExtractionAnalysisIssueSchema),
  hasBlockingIssues: z.boolean(),
});

export const SafeWorkflowOutputSummarySchema = z.strictObject({
  outputName: IdentifierSchema,
  outputType: WorkflowOutputTypeSchema,
  producerStepId: z.string().trim().min(1).max(256),
  status: WorkflowOutputStatusSchema,
});

export type WorkflowOutputType = z.infer<typeof WorkflowOutputTypeSchema>;
export type WorkflowOutputStatus = z.infer<typeof WorkflowOutputStatusSchema>;
export type WorkflowOutputDefinition = z.infer<
  typeof WorkflowOutputDefinitionSchema
>;
export type WorkflowOutputUsage = z.infer<typeof WorkflowOutputUsageSchema>;
export type ExtractionIssueCode = z.infer<typeof ExtractionIssueCodeSchema>;
export type ExtractionAnalysisIssue = z.infer<
  typeof ExtractionAnalysisIssueSchema
>;
export type WorkflowExtractionAnalysis = z.infer<
  typeof WorkflowExtractionAnalysisSchema
>;
export type SafeWorkflowOutputSummary = z.infer<
  typeof SafeWorkflowOutputSummarySchema
>;
