import { z } from 'zod';

import {
  RunnerCompatibilityEvaluationSchema,
  RunnerReleaseArchitectureSchema,
  RunnerReleasePlatformSchema,
  RunnerSoftwareIdentitySchema,
} from '@tasktwin/runner-release';

export const RunnerReleaseCatalogStatusSchema = z.enum([
  'available',
  'deprecated',
  'blocked',
]);

export const RunnerReleaseStatusReasonSchema = z.enum([
  'superseded',
  'end_of_support',
  'security_issue',
  'integrity_issue',
  'compatibility_issue',
  'operational_issue',
]);

export const RunnerComplianceStatusSchema = z.enum([
  'compliant',
  'update_available',
  'update_required',
  'updating_external',
  'rolled_back',
  'unsupported',
  'unknown',
]);

export const RunnerRolloutStatusSchema = z.enum([
  'draft',
  'active',
  'paused',
  'completed',
  'cancelled',
]);

export const RunnerRolloutStageStatusSchema = z.enum([
  'pending',
  'active',
  'completed',
  'failed_review',
  'cancelled',
]);

export const RunnerRolloutAssignmentStatusSchema = z.enum([
  'pending',
  'target_assigned',
  'converged',
  'rolled_back',
  'failed',
  'cancelled',
]);

export const RunnerRolloutReviewReasonSchema = z.enum([
  'assignment_rolled_back',
  'unexpected_version_after_convergence',
  'target_release_blocked',
]);

export const RolloutStageDefinitionSchema = z.strictObject({
  stageNumber: z.number().int().positive().max(10_000),
  runnerDeviceIds: z.array(z.string().uuid()).min(1).max(10_000),
});

export const RolloutPlanSchema = z.strictObject({
  workspaceId: z.string().uuid(),
  targetReleaseId: z.string().uuid(),
  stages: z.array(RolloutStageDefinitionSchema).min(1).max(1_000),
});

export const ReleaseTargetSchema = z.strictObject({
  id: z.string().uuid(),
  product: z.string().min(1).max(64),
  version: z.string().min(1).max(32),
  status: RunnerReleaseCatalogStatusSchema,
  targets: z.array(
    z.strictObject({
      platform: RunnerReleasePlatformSchema,
      architecture: RunnerReleaseArchitectureSchema,
    }),
  ),
});

export const ComplianceInputSchema = z.strictObject({
  actualIdentity: RunnerSoftwareIdentitySchema.nullable(),
  compatibility: RunnerCompatibilityEvaluationSchema,
  actualReleaseStatus: RunnerReleaseCatalogStatusSchema.nullable(),
  desiredVersion: z.string().min(1).max(32).nullable(),
  assignmentStatus: RunnerRolloutAssignmentStatusSchema.nullable(),
  localMaintenanceObserved: z.boolean(),
});

export type RunnerReleaseCatalogStatus = z.infer<
  typeof RunnerReleaseCatalogStatusSchema
>;
export type RunnerReleaseStatusReason = z.infer<
  typeof RunnerReleaseStatusReasonSchema
>;
export type RunnerComplianceStatus = z.infer<
  typeof RunnerComplianceStatusSchema
>;
export type RunnerRolloutStatus = z.infer<typeof RunnerRolloutStatusSchema>;
export type RunnerRolloutStageStatus = z.infer<
  typeof RunnerRolloutStageStatusSchema
>;
export type RunnerRolloutAssignmentStatus = z.infer<
  typeof RunnerRolloutAssignmentStatusSchema
>;
export type RunnerRolloutReviewReason = z.infer<
  typeof RunnerRolloutReviewReasonSchema
>;
export type RolloutStageDefinition = z.infer<
  typeof RolloutStageDefinitionSchema
>;
export type RolloutPlan = z.infer<typeof RolloutPlanSchema>;
export type ReleaseTarget = z.infer<typeof ReleaseTargetSchema>;
export type ComplianceInput = z.infer<typeof ComplianceInputSchema>;
