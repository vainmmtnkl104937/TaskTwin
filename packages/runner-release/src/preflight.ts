import { z } from 'zod';

import {
  ReleaseManifestSchema,
  RunnerReleaseArchitectureSchema,
  RunnerReleasePlatformSchema,
} from './contracts.js';
import { compareProductVersions, ProductSemVerSchema } from './semver.js';

const PositiveSchemaVersionSchema = z
  .number()
  .int()
  .positive()
  .max(2_147_483_647);

export const UpgradePreflightDecisionSchema = z.enum([
  'compatible',
  'migration_required',
  'unsupported',
  'downgrade_blocked',
]);

export const UpgradePreflightReasonSchema = z.enum([
  'target_artifact_missing',
  'local_state_schema_unreadable',
  'local_secret_vault_schema_unreadable',
  'local_secret_vault_profile_unreadable',
  'local_state_migration_required',
  'local_secret_vault_migration_required',
  'persisted_schema_downgrade_blocked',
]);

export const InstalledLocalSecretVaultStateSchema = z.strictObject({
  schemaVersion: PositiveSchemaVersionSchema,
  protectionProfile: z.string().min(1).max(128),
});

export const UpgradePreflightInputSchema = z.strictObject({
  currentVersion: ProductSemVerSchema,
  targetRelease: ReleaseManifestSchema,
  currentLocalStateSchemaVersion: PositiveSchemaVersionSchema,
  currentLocalSecretVault: InstalledLocalSecretVaultStateSchema.nullable(),
  platform: RunnerReleasePlatformSchema,
  architecture: RunnerReleaseArchitectureSchema,
});

export const UpgradePreflightResultSchema = z.strictObject({
  decision: UpgradePreflightDecisionSchema,
  reasons: z.array(UpgradePreflightReasonSchema),
  currentVersion: ProductSemVerSchema,
  targetVersion: ProductSemVerSchema,
});

export type UpgradePreflightDecision = z.infer<
  typeof UpgradePreflightDecisionSchema
>;
export type UpgradePreflightReason = z.infer<
  typeof UpgradePreflightReasonSchema
>;
export type UpgradePreflightInput = z.infer<typeof UpgradePreflightInputSchema>;
export type UpgradePreflightResult = z.infer<
  typeof UpgradePreflightResultSchema
>;

export function evaluateUpgradePreflight(
  rawInput: UpgradePreflightInput,
): UpgradePreflightResult {
  const input = UpgradePreflightInputSchema.parse(rawInput);
  const target = input.targetRelease;
  const isProductDowngrade =
    compareProductVersions(target.version, input.currentVersion) < 0;
  const artifact = target.artifacts.find(
    (candidate) =>
      candidate.platform === input.platform &&
      candidate.architecture === input.architecture,
  );
  if (artifact === undefined) {
    return {
      decision: 'unsupported',
      reasons: ['target_artifact_missing'],
      currentVersion: input.currentVersion,
      targetVersion: target.version,
    };
  }

  const unreadableReasons: UpgradePreflightReason[] = [];
  if (
    !target.compatibility.localState.readableSchemas.includes(
      input.currentLocalStateSchemaVersion,
    )
  ) {
    unreadableReasons.push('local_state_schema_unreadable');
  }

  if (input.currentLocalSecretVault !== null) {
    if (
      !target.compatibility.localSecretVault.readableSchemas.includes(
        input.currentLocalSecretVault.schemaVersion,
      )
    ) {
      unreadableReasons.push('local_secret_vault_schema_unreadable');
    }
    if (
      !target.compatibility.localSecretVault.readableProtectionProfiles.includes(
        input.currentLocalSecretVault.protectionProfile,
      )
    ) {
      unreadableReasons.push('local_secret_vault_profile_unreadable');
    }
  }

  if (unreadableReasons.length > 0) {
    return {
      decision: isProductDowngrade ? 'downgrade_blocked' : 'unsupported',
      reasons: unreadableReasons,
      currentVersion: input.currentVersion,
      targetVersion: target.version,
    };
  }

  const persistedSchemaDowngrade =
    target.compatibility.localState.writableSchema <
      input.currentLocalStateSchemaVersion ||
    (input.currentLocalSecretVault !== null &&
      target.compatibility.localSecretVault.writableSchema <
        input.currentLocalSecretVault.schemaVersion);
  if (persistedSchemaDowngrade) {
    return {
      decision: 'downgrade_blocked',
      reasons: ['persisted_schema_downgrade_blocked'],
      currentVersion: input.currentVersion,
      targetVersion: target.version,
    };
  }

  const migrationReasons: UpgradePreflightReason[] = [];
  if (
    target.compatibility.localState.writableSchema >
    input.currentLocalStateSchemaVersion
  ) {
    migrationReasons.push('local_state_migration_required');
  }
  if (
    input.currentLocalSecretVault !== null &&
    target.compatibility.localSecretVault.writableSchema >
      input.currentLocalSecretVault.schemaVersion
  ) {
    migrationReasons.push('local_secret_vault_migration_required');
  }

  if (migrationReasons.length > 0) {
    return {
      decision: 'migration_required',
      reasons: migrationReasons,
      currentVersion: input.currentVersion,
      targetVersion: target.version,
    };
  }

  return {
    decision: 'compatible',
    reasons: [],
    currentVersion: input.currentVersion,
    targetVersion: target.version,
  };
}
