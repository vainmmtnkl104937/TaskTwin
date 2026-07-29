import {
  ConversionIssueCodeSchema,
  RecordingConversionOptionsSchema,
} from '@tasktwin/recording-converter';
import { z } from 'zod';

const MAX_CONVERSION_ITEMS = 1_000;
const MAX_CONVERSION_ISSUES = 4_000;

const UuidSchema = z.string().uuid();

export const CreateRecordingWorkflowDraftRequestSchema = z.strictObject({
  clientConversionId: UuidSchema,
  name: RecordingConversionOptionsSchema.shape.workflowName,
  description: RecordingConversionOptionsSchema.shape.description,
});

export const RecordingWorkflowDraftIssueCountsSchema = z.strictObject({
  info: z.number().int().nonnegative().max(MAX_CONVERSION_ISSUES),
  warning: z.number().int().nonnegative().max(MAX_CONVERSION_ISSUES),
  blocking: z.number().int().nonnegative().max(MAX_CONVERSION_ISSUES),
});

export const RecordingWorkflowDraftResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  recordingSessionId: UuidSchema,
  clientConversionId: UuidSchema,
  workflowId: z.string().trim().min(1).max(256),
  workflowVersionId: UuidSchema,
  version: z.literal(1),
  status: z.literal('draft'),
  publishable: z.boolean(),
  generatedStepCount: z.number().int().nonnegative().max(MAX_CONVERSION_ITEMS),
  generatedVariableCount: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_CONVERSION_ITEMS),
  deduplicatedEventCount: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_CONVERSION_ITEMS),
  unresolvedEventCount: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_CONVERSION_ITEMS),
  issueCounts: RecordingWorkflowDraftIssueCountsSchema,
  issueCodes: z.array(ConversionIssueCodeSchema).max(MAX_CONVERSION_ISSUES),
  idempotent: z.boolean(),
});

export type CreateRecordingWorkflowDraftRequest = z.infer<
  typeof CreateRecordingWorkflowDraftRequestSchema
>;
export type RecordingWorkflowDraftResponse = z.infer<
  typeof RecordingWorkflowDraftResponseSchema
>;
