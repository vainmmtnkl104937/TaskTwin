import {
  RunnerReleaseArchitectureSchema,
  RunnerReleasePlatformSchema,
  Sha256HexSchema,
} from '@tasktwin/runner-release';
import { z } from 'zod';

import { RUNNER_UPDATE_SCHEMA_VERSION } from './constants.js';
import {
  RunnerReleaseIdSchema,
  RunnerUpdateIdSchema,
  deriveRunnerReleaseId,
} from './contracts.js';
import { RunnerUpdateError } from './errors.js';
import { RunnerInstallationCompatibilityResultSchema } from './installation-compatibility.js';
import { RunnerUpdatePreflightResultSchema } from './compatibility.js';
import { deriveRunnerUpdateId, type RunnerUpdateHasher } from './update-id.js';

export const RunnerUpdatePlanSchema = z
  .strictObject({
    schemaVersion: z.literal(RUNNER_UPDATE_SCHEMA_VERSION),
    operation: z.literal('apply'),
    updateId: RunnerUpdateIdSchema,
    sourceReleaseId: RunnerReleaseIdSchema,
    targetReleaseId: RunnerReleaseIdSchema,
    fromVersion: RunnerUpdatePreflightResultSchema.shape.currentVersion,
    targetVersion: RunnerUpdatePreflightResultSchema.shape.targetVersion,
    platform: RunnerReleasePlatformSchema,
    architecture: RunnerReleaseArchitectureSchema,
    sourceManifestSha256: Sha256HexSchema,
    targetManifestSha256: Sha256HexSchema,
    sourceArtifactSha256: Sha256HexSchema,
    targetArtifactSha256: Sha256HexSchema,
    requireNativeSecretAutoUnlock: z.boolean(),
    preflight: RunnerUpdatePreflightResultSchema,
    installationCompatibility: RunnerInstallationCompatibilityResultSchema,
  })
  .superRefine((plan, context) => {
    if (plan.preflight.decision !== 'allowed') {
      context.addIssue({
        code: 'custom',
        message: 'An update plan requires an allowed state preflight.',
        path: ['preflight'],
      });
    }
    if (plan.installationCompatibility.decision !== 'compatible') {
      context.addIssue({
        code: 'custom',
        message: 'An update plan requires compatible installation state.',
        path: ['installationCompatibility'],
      });
    }
    if (
      plan.fromVersion !== plan.preflight.currentVersion ||
      plan.targetVersion !== plan.preflight.targetVersion
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Plan versions must match the evaluated preflight.',
        path: ['preflight'],
      });
    }
    if (
      plan.sourceReleaseId !== deriveRunnerReleaseId(plan.sourceManifestSha256)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'The source release ID must match its manifest digest.',
        path: ['sourceReleaseId'],
      });
    }
    if (
      plan.targetReleaseId !== deriveRunnerReleaseId(plan.targetManifestSha256)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'The target release ID must match its manifest digest.',
        path: ['targetReleaseId'],
      });
    }
  });

export const CreateRunnerUpdatePlanInputSchema = z.strictObject({
  preflight: RunnerUpdatePreflightResultSchema,
  installationCompatibility: RunnerInstallationCompatibilityResultSchema,
  platform: RunnerReleasePlatformSchema,
  architecture: RunnerReleaseArchitectureSchema,
  sourceManifestSha256: Sha256HexSchema,
  targetManifestSha256: Sha256HexSchema,
  sourceArtifactSha256: Sha256HexSchema,
  targetArtifactSha256: Sha256HexSchema,
  requireNativeSecretAutoUnlock: z.boolean(),
});

export type RunnerUpdatePlan = z.infer<typeof RunnerUpdatePlanSchema>;
export type CreateRunnerUpdatePlanInput = z.infer<
  typeof CreateRunnerUpdatePlanInputSchema
>;

/** Creates a deterministic, safe apply plan only after every proof succeeds. */
export function createRunnerUpdatePlan(
  rawInput: CreateRunnerUpdatePlanInput,
  hasher: RunnerUpdateHasher,
): RunnerUpdatePlan {
  const input = CreateRunnerUpdatePlanInputSchema.parse(rawInput);
  if (input.preflight.decision !== 'allowed') {
    const code = input.preflight.reasons.includes('forward_migration_required')
      ? 'update_migration_required'
      : input.preflight.reasons.some((reason) => reason.startsWith('rollback_'))
        ? 'update_rollback_unproven'
        : input.preflight.reasons.includes('target_version_not_newer')
          ? 'update_target_version_not_newer'
          : 'update_forward_compatibility_failed';
    throw new RunnerUpdateError(code, 'Runner update preflight is blocked.');
  }
  if (input.installationCompatibility.decision !== 'compatible') {
    const rollbackUnproven = input.installationCompatibility.reasons.some(
      (reason) => reason.startsWith('source_'),
    );
    throw new RunnerUpdateError(
      rollbackUnproven
        ? 'update_rollback_unproven'
        : 'update_forward_compatibility_failed',
      'Runner installation compatibility is not proven.',
    );
  }

  const updateId = deriveRunnerUpdateId(
    {
      operation: 'apply',
      sourceManifestSha256: input.sourceManifestSha256,
      targetManifestSha256: input.targetManifestSha256,
    },
    hasher,
  );
  return RunnerUpdatePlanSchema.parse({
    schemaVersion: RUNNER_UPDATE_SCHEMA_VERSION,
    operation: 'apply',
    updateId,
    sourceReleaseId: deriveRunnerReleaseId(input.sourceManifestSha256),
    targetReleaseId: deriveRunnerReleaseId(input.targetManifestSha256),
    fromVersion: input.preflight.currentVersion,
    targetVersion: input.preflight.targetVersion,
    platform: input.platform,
    architecture: input.architecture,
    sourceManifestSha256: input.sourceManifestSha256,
    targetManifestSha256: input.targetManifestSha256,
    sourceArtifactSha256: input.sourceArtifactSha256,
    targetArtifactSha256: input.targetArtifactSha256,
    requireNativeSecretAutoUnlock: input.requireNativeSecretAutoUnlock,
    preflight: input.preflight,
    installationCompatibility: input.installationCompatibility,
  });
}
