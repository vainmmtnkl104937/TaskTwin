import {
  InstalledLocalSecretVaultStateSchema,
  ReleaseManifestSchema,
  RunnerReleaseArchitectureSchema,
  RunnerReleasePlatformSchema,
  UpgradePreflightResultSchema,
  compareProductVersions,
  evaluateUpgradePreflight,
  type ReleaseManifest,
  type RunnerReleaseArchitecture,
  type RunnerReleasePlatform,
  type UpgradePreflightResult,
} from '@tasktwin/runner-release';
import { z } from 'zod';

const PositiveSchemaVersionSchema = z
  .number()
  .int()
  .positive()
  .max(2_147_483_647);

export const RunnerUpdatePreflightDecisionSchema = z.enum([
  'allowed',
  'blocked',
]);

export const RunnerUpdatePreflightReasonSchema = z.enum([
  'target_version_not_newer',
  'forward_compatibility_unsupported',
  'forward_migration_required',
  'forward_downgrade_blocked',
  'rollback_compatibility_unsupported',
  'rollback_migration_required',
  'rollback_downgrade_blocked',
]);

export const RunnerUpdatePreflightInputSchema = z.strictObject({
  currentRelease: ReleaseManifestSchema,
  targetRelease: ReleaseManifestSchema,
  currentLocalStateSchemaVersion: PositiveSchemaVersionSchema,
  currentLocalSecretVault: InstalledLocalSecretVaultStateSchema.nullable(),
  platform: RunnerReleasePlatformSchema,
  architecture: RunnerReleaseArchitectureSchema,
});

export const RunnerUpdatePreflightResultSchema = z
  .strictObject({
    decision: RunnerUpdatePreflightDecisionSchema,
    reasons: z.array(RunnerUpdatePreflightReasonSchema),
    currentVersion: ReleaseManifestSchema.shape.version,
    targetVersion: ReleaseManifestSchema.shape.version,
    forward: UpgradePreflightResultSchema,
    rollback: UpgradePreflightResultSchema,
  })
  .superRefine((result, context) => {
    if (result.decision === 'allowed' && result.reasons.length !== 0) {
      context.addIssue({
        code: 'custom',
        message: 'An allowed update cannot contain blocking reasons.',
        path: ['reasons'],
      });
    }
    if (result.decision === 'blocked' && result.reasons.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'A blocked update requires at least one reason.',
        path: ['reasons'],
      });
    }
  });

export type RunnerUpdatePreflightDecision = z.infer<
  typeof RunnerUpdatePreflightDecisionSchema
>;
export type RunnerUpdatePreflightReason = z.infer<
  typeof RunnerUpdatePreflightReasonSchema
>;
export interface RunnerUpdatePreflightInput {
  currentRelease: ReleaseManifest;
  targetRelease: ReleaseManifest;
  currentLocalStateSchemaVersion: number;
  currentLocalSecretVault: z.infer<
    typeof InstalledLocalSecretVaultStateSchema
  > | null;
  platform: RunnerReleasePlatform;
  architecture: RunnerReleaseArchitecture;
}
export type RunnerUpdatePreflightResult = z.infer<
  typeof RunnerUpdatePreflightResultSchema
>;

export const RunnerRollbackCompatibilityDecisionSchema = z.enum([
  'safe',
  'unsafe',
]);

export const RunnerRollbackCompatibilityInputSchema = z.strictObject({
  currentVersion: ReleaseManifestSchema.shape.version,
  rollbackRelease: ReleaseManifestSchema,
  currentLocalStateSchemaVersion: PositiveSchemaVersionSchema,
  currentLocalSecretVault: InstalledLocalSecretVaultStateSchema.nullable(),
  platform: RunnerReleasePlatformSchema,
  architecture: RunnerReleaseArchitectureSchema,
});

export const RunnerRollbackCompatibilityResultSchema = z.strictObject({
  decision: RunnerRollbackCompatibilityDecisionSchema,
  preflight: UpgradePreflightResultSchema,
});

export type RunnerRollbackCompatibilityInput = z.infer<
  typeof RunnerRollbackCompatibilityInputSchema
>;
export type RunnerRollbackCompatibilityDecision = z.infer<
  typeof RunnerRollbackCompatibilityDecisionSchema
>;
export type RunnerRollbackCompatibilityResult = z.infer<
  typeof RunnerRollbackCompatibilityResultSchema
>;

function forwardReason(
  result: UpgradePreflightResult,
): RunnerUpdatePreflightReason | null {
  switch (result.decision) {
    case 'compatible':
      return null;
    case 'migration_required':
      return 'forward_migration_required';
    case 'unsupported':
      return 'forward_compatibility_unsupported';
    case 'downgrade_blocked':
      return 'forward_downgrade_blocked';
  }
}

function rollbackReason(
  result: UpgradePreflightResult,
): RunnerUpdatePreflightReason | null {
  switch (result.decision) {
    case 'compatible':
      return null;
    case 'migration_required':
      return 'rollback_migration_required';
    case 'unsupported':
      return 'rollback_compatibility_unsupported';
    case 'downgrade_blocked':
      return 'rollback_downgrade_blocked';
  }
}

/**
 * Proves both directions without changing local state. The rollback projection
 * conservatively assumes that the target may write every schema it declares as
 * writable while leaving the existing vault protection profile unchanged.
 */
export function evaluateRunnerUpdatePreflight(
  rawInput: RunnerUpdatePreflightInput,
): RunnerUpdatePreflightResult {
  const input = RunnerUpdatePreflightInputSchema.parse(rawInput);
  const forward = evaluateUpgradePreflight({
    currentVersion: input.currentRelease.version,
    targetRelease: input.targetRelease,
    currentLocalStateSchemaVersion: input.currentLocalStateSchemaVersion,
    currentLocalSecretVault: input.currentLocalSecretVault,
    platform: input.platform,
    architecture: input.architecture,
  });

  const prospectiveVault =
    input.currentLocalSecretVault === null
      ? null
      : {
          schemaVersion:
            input.targetRelease.compatibility.localSecretVault.writableSchema,
          protectionProfile: input.currentLocalSecretVault.protectionProfile,
        };
  const rollback = evaluateUpgradePreflight({
    currentVersion: input.targetRelease.version,
    targetRelease: input.currentRelease,
    currentLocalStateSchemaVersion:
      input.targetRelease.compatibility.localState.writableSchema,
    currentLocalSecretVault: prospectiveVault,
    platform: input.platform,
    architecture: input.architecture,
  });

  const reasons: RunnerUpdatePreflightReason[] = [];
  if (
    compareProductVersions(
      input.targetRelease.version,
      input.currentRelease.version,
    ) <= 0
  ) {
    reasons.push('target_version_not_newer');
  }
  const forwardBlock = forwardReason(forward);
  if (forwardBlock !== null) reasons.push(forwardBlock);
  const rollbackBlock = rollbackReason(rollback);
  if (rollbackBlock !== null) reasons.push(rollbackBlock);

  return RunnerUpdatePreflightResultSchema.parse({
    decision: reasons.length === 0 ? 'allowed' : 'blocked',
    reasons,
    currentVersion: input.currentRelease.version,
    targetVersion: input.targetRelease.version,
    forward,
    rollback,
  });
}

/** Rechecks rollback safety against state as it exists immediately before it. */
export function evaluateRunnerRollbackCompatibility(
  rawInput: RunnerRollbackCompatibilityInput,
): RunnerRollbackCompatibilityResult {
  const input = RunnerRollbackCompatibilityInputSchema.parse(rawInput);
  const preflight = evaluateUpgradePreflight({
    currentVersion: input.currentVersion,
    targetRelease: input.rollbackRelease,
    currentLocalStateSchemaVersion: input.currentLocalStateSchemaVersion,
    currentLocalSecretVault: input.currentLocalSecretVault,
    platform: input.platform,
    architecture: input.architecture,
  });
  return RunnerRollbackCompatibilityResultSchema.parse({
    decision: preflight.decision === 'compatible' ? 'safe' : 'unsafe',
    preflight,
  });
}
