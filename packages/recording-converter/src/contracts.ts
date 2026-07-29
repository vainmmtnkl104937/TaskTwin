import { LocatorBundleSchema } from '@tasktwin/locator-engine';
import {
  MAX_RECORDING_EVENTS,
  RecordingEventCountSchema,
  RecordingEventTypeSchema,
  RecordingSequenceSchema,
  UuidSchema,
} from '@tasktwin/recording-schema';
import {
  NonEmptyStringSchema,
  WorkflowDefinitionSchema,
} from '@tasktwin/workflow-schema';
import { z } from 'zod';

import {
  MAX_CONVERSION_ISSUES,
  MAX_WORKFLOW_DESCRIPTION_LENGTH,
  MAX_WORKFLOW_ID_LENGTH,
  MAX_WORKFLOW_NAME_LENGTH,
} from './constants.js';

export const ConversionIssueSeveritySchema = z.enum([
  'info',
  'warning',
  'blocking',
]);

export const ConversionIssueCodeSchema = z.enum([
  'LOW_LOCATOR_CONFIDENCE',
  'NO_USABLE_LOCATOR',
  'UNSUPPORTED_EVENT_TYPE',
  'INVALID_EVENT_PAYLOAD',
  'BLOCKED_VALUE_UNRESOLVED',
  'MASKED_VALUE_UNRESOLVED',
  'TRUNCATED_VALUE_UNRESOLVED',
  'DUPLICATE_EVENT_REMOVED',
  'NO_EXECUTABLE_STEPS',
]);

export const CONVERSION_ISSUE_DETAILS = {
  LOW_LOCATOR_CONFIDENCE: {
    severity: 'warning',
    message: 'The recorded locator has low confidence.',
  },
  NO_USABLE_LOCATOR: {
    severity: 'blocking',
    message: 'The event has no usable unique locator.',
  },
  UNSUPPORTED_EVENT_TYPE: {
    severity: 'blocking',
    message: 'The recording event type is not supported.',
  },
  INVALID_EVENT_PAYLOAD: {
    severity: 'blocking',
    message: 'The recording event payload is invalid.',
  },
  BLOCKED_VALUE_UNRESOLVED: {
    severity: 'blocking',
    message: 'The blocked value cannot be represented safely.',
  },
  MASKED_VALUE_UNRESOLVED: {
    severity: 'blocking',
    message: 'The masked value cannot be represented safely.',
  },
  TRUNCATED_VALUE_UNRESOLVED: {
    severity: 'blocking',
    message: 'The truncated value cannot be replayed deterministically.',
  },
  DUPLICATE_EVENT_REMOVED: {
    severity: 'info',
    message: 'An exact consecutive redundant event was removed.',
  },
  NO_EXECUTABLE_STEPS: {
    severity: 'blocking',
    message: 'The recording produced no executable workflow steps.',
  },
} as const satisfies Record<
  z.infer<typeof ConversionIssueCodeSchema>,
  {
    severity: z.infer<typeof ConversionIssueSeveritySchema>;
    message: string;
  }
>;

export const ConversionIssueSchema = z
  .strictObject({
    code: ConversionIssueCodeSchema,
    severity: ConversionIssueSeveritySchema,
    message: z.string().trim().min(1).max(160),
    eventId: UuidSchema.optional(),
    sequence: RecordingSequenceSchema.optional(),
    stepId: NonEmptyStringSchema.optional(),
  })
  .superRefine((issue, context) => {
    const expected = CONVERSION_ISSUE_DETAILS[issue.code];
    if (issue.severity !== expected.severity) {
      context.addIssue({
        code: 'custom',
        path: ['severity'],
        message: 'Issue severity must match its deterministic issue code.',
      });
    }
    if (issue.message !== expected.message) {
      context.addIssue({
        code: 'custom',
        path: ['message'],
        message: 'Issue message must match its deterministic issue code.',
      });
    }
  });

const EventMappingBaseShape = {
  eventId: UuidSchema,
  sequence: RecordingSequenceSchema,
  eventType: RecordingEventTypeSchema,
};

export const ConvertedEventStepMappingSchema = z.strictObject({
  ...EventMappingBaseShape,
  outcome: z.literal('converted'),
  stepId: NonEmptyStringSchema,
  locatorBundle: LocatorBundleSchema,
});

export const DeduplicatedEventStepMappingSchema = z.strictObject({
  ...EventMappingBaseShape,
  outcome: z.literal('deduplicated'),
  retainedEventId: UuidSchema,
  retainedStepId: NonEmptyStringSchema,
  locatorBundle: LocatorBundleSchema,
});

export const UnresolvedEventStepMappingSchema = z.strictObject({
  ...EventMappingBaseShape,
  outcome: z.literal('unresolved'),
  issueCodes: z.array(ConversionIssueCodeSchema).min(1).max(8),
  locatorBundle: LocatorBundleSchema.optional(),
});

export const EventStepMappingSchema = z.discriminatedUnion('outcome', [
  ConvertedEventStepMappingSchema,
  DeduplicatedEventStepMappingSchema,
  UnresolvedEventStepMappingSchema,
]);

export const UnresolvedRecordingEventSchema = z.strictObject({
  eventId: UuidSchema,
  sequence: RecordingSequenceSchema,
  eventType: RecordingEventTypeSchema,
  issueCodes: z.array(ConversionIssueCodeSchema).min(1).max(8),
});

export const RecordingConversionOptionsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workflowId: z.string().trim().min(1).max(MAX_WORKFLOW_ID_LENGTH),
  workflowName: z.string().trim().min(1).max(MAX_WORKFLOW_NAME_LENGTH),
  description: z
    .string()
    .trim()
    .min(1)
    .max(MAX_WORKFLOW_DESCRIPTION_LENGTH)
    .optional(),
});

export const RecordingConversionReportSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    sourceClientSessionId: UuidSchema,
    sourceEventCount: RecordingEventCountSchema,
    generatedStepCount: RecordingEventCountSchema,
    generatedVariableCount: RecordingEventCountSchema,
    deduplicatedEventCount: RecordingEventCountSchema,
    unresolvedEventCount: RecordingEventCountSchema,
    mappings: z.array(EventStepMappingSchema).max(MAX_RECORDING_EVENTS),
    issues: z.array(ConversionIssueSchema).max(MAX_CONVERSION_ISSUES),
    unresolvedEvents: z
      .array(UnresolvedRecordingEventSchema)
      .max(MAX_RECORDING_EVENTS),
    publishable: z.boolean(),
  })
  .superRefine((report, context) => {
    if (report.mappings.length !== report.sourceEventCount) {
      context.addIssue({
        code: 'custom',
        path: ['mappings'],
        message: 'Every source event must have one conversion mapping.',
      });
    }

    const deduplicatedCount = report.mappings.filter(
      (mapping) => mapping.outcome === 'deduplicated',
    ).length;
    if (deduplicatedCount !== report.deduplicatedEventCount) {
      context.addIssue({
        code: 'custom',
        path: ['deduplicatedEventCount'],
        message: 'Deduplicated count must match conversion mappings.',
      });
    }

    if (report.unresolvedEvents.length !== report.unresolvedEventCount) {
      context.addIssue({
        code: 'custom',
        path: ['unresolvedEventCount'],
        message: 'Unresolved count must match unresolved event records.',
      });
    }

    report.mappings.forEach((mapping, index) => {
      if (mapping.sequence !== index + 1) {
        context.addIssue({
          code: 'custom',
          path: ['mappings', index, 'sequence'],
          message: 'Conversion mappings must preserve source sequence order.',
        });
      }
    });

    const hasBlockingIssue = report.issues.some(
      (issue) => issue.severity === 'blocking',
    );
    if (report.publishable === hasBlockingIssue) {
      context.addIssue({
        code: 'custom',
        path: ['publishable'],
        message:
          'Publishable must be false exactly when a blocking issue exists.',
      });
    }
  });

const WorkflowDraftConversionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal('draft'),
    workflowDefinition: WorkflowDefinitionSchema,
    report: RecordingConversionReportSchema,
  })
  .superRefine((result, context) => {
    if (
      result.workflowDefinition.steps.length !==
      result.report.generatedStepCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['report', 'generatedStepCount'],
        message: 'Generated step count must match the workflow definition.',
      });
    }
    if (
      result.workflowDefinition.variables.length !==
      result.report.generatedVariableCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['report', 'generatedVariableCount'],
        message: 'Generated variable count must match the workflow definition.',
      });
    }
  });

const NoExecutableStepsConversionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal('no-executable-steps'),
    workflowDefinition: z.null(),
    report: RecordingConversionReportSchema,
  })
  .superRefine((result, context) => {
    if (result.report.generatedStepCount !== 0 || result.report.publishable) {
      context.addIssue({
        code: 'custom',
        path: ['report'],
        message:
          'A no-executable-steps result must have zero steps and be non-publishable.',
      });
    }
  });

export const WorkflowDraftConversionResultSchema = z.discriminatedUnion(
  'outcome',
  [WorkflowDraftConversionSchema, NoExecutableStepsConversionSchema],
);

export type ConversionIssueSeverity = z.infer<
  typeof ConversionIssueSeveritySchema
>;
export type ConversionIssueCode = z.infer<typeof ConversionIssueCodeSchema>;
export type ConversionIssue = z.infer<typeof ConversionIssueSchema>;
export type EventStepMapping = z.infer<typeof EventStepMappingSchema>;
export type UnresolvedRecordingEvent = z.infer<
  typeof UnresolvedRecordingEventSchema
>;
export type RecordingConversionOptions = z.infer<
  typeof RecordingConversionOptionsSchema
>;
export type RecordingConversionReport = z.infer<
  typeof RecordingConversionReportSchema
>;
export type WorkflowDraftConversionResult = z.infer<
  typeof WorkflowDraftConversionResultSchema
>;
export type WorkflowDraftConversion = z.infer<
  typeof WorkflowDraftConversionSchema
>;
