import { WorkflowAssertionSchema } from '@tasktwin/workflow-schema';
import { z } from 'zod';

import {
  MAX_VERIFICATION_ATTEMPTS,
  WORKFLOW_VERIFICATION_SCHEMA_VERSION,
} from './constants.js';

export const VerificationRuleSchema = WorkflowAssertionSchema;

export const VerificationKindSchema = z.enum([
  'url',
  'text',
  'visibility',
  'fieldValue',
  'checked',
]);

export const VerificationOutcomeSchema = z.enum(['matched', 'not_matched']);
export const SafeObservedStateSchema = z.enum([
  'visible',
  'hidden',
  'absent',
  'checked',
  'unchecked',
]);

export const SafeVerificationResultSchema = z
  .strictObject({
    schemaVersion: z.literal(WORKFLOW_VERIFICATION_SCHEMA_VERSION),
    kind: VerificationKindSchema,
    outcome: VerificationOutcomeSchema,
    attemptCount: z.number().int().positive().max(MAX_VERIFICATION_ATTEMPTS),
    durationMs: z.number().int().nonnegative(),
    observedState: SafeObservedStateSchema.optional(),
  })
  .superRefine((result, context) => {
    const permitsState =
      result.kind === 'visibility' || result.kind === 'checked';
    if (!permitsState && result.observedState !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['observedState'],
        message: 'Observed state is not allowed for this verification kind.',
      });
    }
  });

export const VerificationErrorCodeSchema = z.enum([
  'VERIFICATION_RULE_INVALID',
  'VERIFICATION_EXPECTATION_INVALID',
  'VERIFICATION_NOT_MATCHED',
  'VERIFICATION_TARGET_UNSUPPORTED',
]);

export const VerificationAnalysisIssueCodeSchema = z.enum([
  'VERIFICATION_RULE_INVALID',
  'VERIFICATION_SECRET_EXPECTATION_FORBIDDEN',
  'VERIFICATION_FILE_EXPECTATION_FORBIDDEN',
  'VERIFICATION_EXPECTATION_TYPE_INCOMPATIBLE',
  'VERIFICATION_EXPECTATION_TOO_LONG',
  'VERIFICATION_URL_INVALID',
  'VERIFICATION_URL_UNSAFE',
  'VERIFICATION_LEGACY_OPERATOR_UNSUPPORTED',
]);

export const VerificationAnalysisIssueSchema = z.strictObject({
  code: VerificationAnalysisIssueCodeSchema,
  message: z.string().trim().min(1).max(240),
  path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
  stepId: z.string().trim().min(1),
  stepIndex: z.number().int().nonnegative(),
});

export const WorkflowVerificationAnalysisSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_VERIFICATION_SCHEMA_VERSION),
  hasValidVerification: z.boolean(),
  verificationStepCount: z.number().int().nonnegative(),
  issues: z.array(VerificationAnalysisIssueSchema),
});

export type VerificationRule = z.infer<typeof VerificationRuleSchema>;
export type VerificationKind = z.infer<typeof VerificationKindSchema>;
export type VerificationOutcome = z.infer<typeof VerificationOutcomeSchema>;
export type SafeObservedState = z.infer<typeof SafeObservedStateSchema>;
export type SafeVerificationResult = z.infer<
  typeof SafeVerificationResultSchema
>;
export type VerificationErrorCode = z.infer<typeof VerificationErrorCodeSchema>;
export type VerificationAnalysisIssue = z.infer<
  typeof VerificationAnalysisIssueSchema
>;
export type WorkflowVerificationAnalysis = z.infer<
  typeof WorkflowVerificationAnalysisSchema
>;
