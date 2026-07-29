import {
  IdentifierSchema,
  WorkflowVariableSchema,
  WorkflowVariableValueTypeSchema,
} from '@tasktwin/workflow-schema';
import { z } from 'zod';

import {
  MAX_RUNTIME_FILE_SIZE_BYTES,
  MAX_RUNTIME_MEDIA_TYPE_LENGTH,
  MAX_RUNTIME_STRING_LENGTH,
  WORKFLOW_INPUTS_SCHEMA_VERSION,
} from './constants.js';

export const ValueSourceTargetSchema = z.enum([
  'navigate.url',
  'fill.value',
  'select.value',
  'verify.text.expected',
  'verify.value.expected',
  'verify.url.expected',
]);

export const WorkflowInputIssueCodeSchema = z.enum([
  'INVALID_WORKFLOW_DEFINITION',
  'DUPLICATE_VARIABLE_NAME',
  'UNKNOWN_VARIABLE_REFERENCE',
  'INCOMPATIBLE_VARIABLE_TYPE',
  'INCOMPATIBLE_LITERAL',
  'SECRET_SOURCE_NOT_ALLOWED',
  'UNSAFE_SECRET_REFERENCE',
  'UNUSED_VARIABLE',
]);

export const WorkflowInputIssueSchema = z.strictObject({
  code: WorkflowInputIssueCodeSchema,
  severity: z.enum(['blocking', 'warning']),
  message: z.string().trim().min(1).max(240),
  path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
  stepId: z.string().trim().min(1).optional(),
  stepIndex: z.number().int().nonnegative().optional(),
  variableName: IdentifierSchema.optional(),
});

export const VariableUsageSchema = z.strictObject({
  stepId: z.string().trim().min(1),
  stepIndex: z.number().int().nonnegative(),
  stepType: z.string().trim().min(1),
  target: ValueSourceTargetSchema,
  path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
  acceptedVariableTypes: z.array(WorkflowVariableValueTypeSchema),
});

export const WorkflowVariableAnalysisSchema = z.strictObject({
  variable: WorkflowVariableSchema,
  usageCount: z.number().int().nonnegative(),
  usages: z.array(VariableUsageSchema),
});

export const WorkflowSecretRequirementSchema = z.strictObject({
  secretName: IdentifierSchema,
  usageCount: z.number().int().positive(),
  usages: z.array(VariableUsageSchema).min(1),
});

export const WorkflowInputAnalysisSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_INPUTS_SCHEMA_VERSION),
  workflowId: z.string(),
  workflowVersion: z.number().int().nonnegative(),
  variables: z.array(WorkflowVariableAnalysisSchema),
  secretRequirements: z.array(WorkflowSecretRequirementSchema),
  issues: z.array(WorkflowInputIssueSchema),
  hasBlockingIssues: z.boolean(),
});

const DateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a valid YYYY-MM-DD date.')
  .refine((value) => {
    const [yearText, monthText, dayText] = value.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, 'Must be a valid calendar date.');

export const RuntimeFileMetadataSchema = z.strictObject({
  sizeBytes: z.number().int().nonnegative().max(MAX_RUNTIME_FILE_SIZE_BYTES),
  mediaType: z.string().max(MAX_RUNTIME_MEDIA_TYPE_LENGTH).optional(),
});

export const RuntimeInputValueSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('string'),
    value: z.string().max(MAX_RUNTIME_STRING_LENGTH),
  }),
  z.strictObject({
    kind: z.literal('number'),
    value: z.number().finite(),
  }),
  z.strictObject({
    kind: z.literal('boolean'),
    value: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('date'),
    value: DateOnlySchema,
  }),
  z.strictObject({
    kind: z.literal('file'),
    metadata: RuntimeFileMetadataSchema,
  }),
]);

export const WorkflowRunInputSubmissionSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_INPUTS_SCHEMA_VERSION),
  values: z.record(IdentifierSchema, RuntimeInputValueSchema),
});

export const RunInputIssueSchema = z.strictObject({
  code: z.enum([
    'INVALID_SUBMISSION',
    'MISSING_REQUIRED_INPUT',
    'UNKNOWN_RUNTIME_INPUT',
    'RUNTIME_INPUT_TYPE_MISMATCH',
  ]),
  message: z.string().trim().min(1).max(240),
  variableName: IdentifierSchema.optional(),
  path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
});

export const SafeRunInputSummarySchema = z.strictObject({
  declaredCount: z.number().int().nonnegative(),
  requiredCount: z.number().int().nonnegative(),
  providedCount: z.number().int().nonnegative(),
  missingRequiredCount: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  issueCount: z.number().int().nonnegative(),
  valid: z.boolean(),
});

export const PreparedRunInputPlanSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_INPUTS_SCHEMA_VERSION),
  workflowId: z.string(),
  workflowVersion: z.number().int().nonnegative(),
  variables: z.array(WorkflowVariableSchema),
  secretRequirements: z.array(WorkflowSecretRequirementSchema),
  issues: z.array(WorkflowInputIssueSchema),
  canCollectInputs: z.boolean(),
});

export const RunInputValidationResultSchema = z.strictObject({
  issues: z.array(RunInputIssueSchema),
  summary: SafeRunInputSummarySchema,
});

export type ValueSourceTarget = z.infer<typeof ValueSourceTargetSchema>;
export type WorkflowInputIssueCode = z.infer<
  typeof WorkflowInputIssueCodeSchema
>;
export type WorkflowInputIssue = z.infer<typeof WorkflowInputIssueSchema>;
export type VariableUsage = z.infer<typeof VariableUsageSchema>;
export type WorkflowVariableAnalysis = z.infer<
  typeof WorkflowVariableAnalysisSchema
>;
export type WorkflowSecretRequirement = z.infer<
  typeof WorkflowSecretRequirementSchema
>;
export type WorkflowInputAnalysis = z.infer<typeof WorkflowInputAnalysisSchema>;
export type RuntimeFileMetadata = z.infer<typeof RuntimeFileMetadataSchema>;
export type RuntimeInputValue = z.infer<typeof RuntimeInputValueSchema>;
export type WorkflowRunInputSubmission = z.infer<
  typeof WorkflowRunInputSubmissionSchema
>;
export type RunInputIssue = z.infer<typeof RunInputIssueSchema>;
export type SafeRunInputSummary = z.infer<typeof SafeRunInputSummarySchema>;
export type PreparedRunInputPlan = z.infer<typeof PreparedRunInputPlanSchema>;
export type RunInputValidationResult = z.infer<
  typeof RunInputValidationResultSchema
>;
