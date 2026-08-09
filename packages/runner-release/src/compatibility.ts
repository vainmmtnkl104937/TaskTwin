import { z } from 'zod';

import {
  RunnerReleaseArchitectureSchema,
  RunnerReleasePlatformSchema,
  RunnerSoftwareIdentitySchema,
  type RunnerSoftwareIdentity,
} from './contracts.js';
import { compareProductVersions, ProductSemVerSchema } from './semver.js';

const PositiveVersionSchema = z.number().int().positive().max(2_147_483_647);

function hasDuplicates(values: readonly unknown[]): boolean {
  return new Set<unknown>(values).size !== values.length;
}

export const RunnerCompatibilityStatusSchema = z.enum([
  'compatible',
  'update_recommended',
  'update_required',
  'unsupported',
]);

export const RunnerCompatibilityReasonSchema = z.enum([
  'software_identity_missing',
  'product_unsupported',
  'platform_unsupported',
  'architecture_unsupported',
  'runner_protocol_unsupported',
  'workflow_schema_unsupported',
  'local_state_schema_unsupported',
  'product_version_below_minimum',
  'product_update_recommended',
]);

export const ControlPlaneRunnerCompatibilityPolicySchema = z
  .strictObject({
    product: RunnerSoftwareIdentitySchema.shape.product,
    supportedPlatforms: z.array(RunnerReleasePlatformSchema).min(1),
    supportedArchitectures: z.array(RunnerReleaseArchitectureSchema).min(1),
    supportedRunnerProtocolVersions: z.array(PositiveVersionSchema).min(1),
    supportedWorkflowSchemaVersions: z.array(PositiveVersionSchema).min(1),
    supportedLocalStateSchemaVersions: z.array(PositiveVersionSchema).min(1),
    minimumVersion: ProductSemVerSchema,
    recommendedVersion: ProductSemVerSchema,
  })
  .superRefine((policy, context) => {
    if (
      compareProductVersions(policy.minimumVersion, policy.recommendedVersion) >
      0
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Minimum Runner version cannot exceed the recommended version.',
        path: ['minimumVersion'],
      });
    }

    const uniqueFields = [
      'supportedPlatforms',
      'supportedArchitectures',
      'supportedRunnerProtocolVersions',
      'supportedWorkflowSchemaVersions',
      'supportedLocalStateSchemaVersions',
    ] as const;
    uniqueFields.forEach((field) => {
      const values = policy[field];
      if (hasDuplicates(values)) {
        context.addIssue({
          code: 'custom',
          message: `${field} must not contain duplicates.`,
          path: [field],
        });
      }
    });
  });

export const RunnerCompatibilityEvaluationSchema = z.strictObject({
  status: RunnerCompatibilityStatusSchema,
  reasons: z.array(RunnerCompatibilityReasonSchema),
});

export type RunnerCompatibilityStatus = z.infer<
  typeof RunnerCompatibilityStatusSchema
>;
export type RunnerCompatibilityReason = z.infer<
  typeof RunnerCompatibilityReasonSchema
>;
export type ControlPlaneRunnerCompatibilityPolicy = z.infer<
  typeof ControlPlaneRunnerCompatibilityPolicySchema
>;
export type RunnerCompatibilityEvaluation = z.infer<
  typeof RunnerCompatibilityEvaluationSchema
>;

export function evaluateRunnerCompatibility(input: {
  identity: RunnerSoftwareIdentity | null;
  policy: ControlPlaneRunnerCompatibilityPolicy;
}): RunnerCompatibilityEvaluation {
  const policy = ControlPlaneRunnerCompatibilityPolicySchema.parse(
    input.policy,
  );
  if (input.identity === null) {
    return {
      status: 'update_required',
      reasons: ['software_identity_missing'],
    };
  }

  const identity = RunnerSoftwareIdentitySchema.parse(input.identity);
  const hardReasons: RunnerCompatibilityReason[] = [];

  if (identity.product !== policy.product)
    hardReasons.push('product_unsupported');
  if (!policy.supportedPlatforms.includes(identity.platform)) {
    hardReasons.push('platform_unsupported');
  }
  if (!policy.supportedArchitectures.includes(identity.architecture)) {
    hardReasons.push('architecture_unsupported');
  }
  if (
    !policy.supportedRunnerProtocolVersions.includes(
      identity.runnerProtocolVersion,
    )
  ) {
    hardReasons.push('runner_protocol_unsupported');
  }
  if (
    !policy.supportedWorkflowSchemaVersions.includes(
      identity.workflowSchemaVersion,
    )
  ) {
    hardReasons.push('workflow_schema_unsupported');
  }
  if (
    !policy.supportedLocalStateSchemaVersions.includes(
      identity.localStateSchemaVersion,
    )
  ) {
    hardReasons.push('local_state_schema_unsupported');
  }

  if (hardReasons.length > 0) {
    return { status: 'unsupported', reasons: hardReasons };
  }

  if (compareProductVersions(identity.version, policy.minimumVersion) < 0) {
    return {
      status: 'update_required',
      reasons: ['product_version_below_minimum'],
    };
  }

  if (compareProductVersions(identity.version, policy.recommendedVersion) < 0) {
    return {
      status: 'update_recommended',
      reasons: ['product_update_recommended'],
    };
  }

  return { status: 'compatible', reasons: [] };
}

export function runnerCompatibilityAllowsClaims(
  status: RunnerCompatibilityStatus,
): boolean {
  return status === 'compatible' || status === 'update_recommended';
}
