import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  LOCAL_RUNNER_STATE_SCHEMA_VERSION,
  RunnerReleaseError,
  type UpgradePreflightInput,
} from '@tasktwin/runner-release';
import { MAX_LOCAL_VAULT_FILE_BYTES } from '@tasktwin/local-secret-store';

const MAX_LOCAL_STATE_HEADER_BYTES = 16 * 1024;

type InstalledVaultState = NonNullable<
  UpgradePreflightInput['currentLocalSecretVault']
>;

async function readRegularJson(
  path: string,
  maximumBytes: number,
): Promise<unknown | null> {
  const file = await lstat(path).catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (file === null) return null;
  if (!file.isFile() || file.isSymbolicLink() || file.size > maximumBytes) {
    throw new RunnerReleaseError(
      'release_state_unsupported',
      'Persisted Runner state cannot be inspected safely.',
    );
  }
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    throw new RunnerReleaseError(
      'release_state_unsupported',
      'Persisted Runner state cannot be inspected safely.',
    );
  }
}

function schemaVersionOf(value: unknown): number | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    !Number.isInteger(value.schemaVersion) ||
    (value.schemaVersion as number) < 1
  ) {
    return null;
  }
  return value.schemaVersion as number;
}

function vaultStateOf(value: unknown): InstalledVaultState | null {
  if (value === null) return null;
  const schemaVersion = schemaVersionOf(value);
  if (
    schemaVersion === null ||
    typeof value !== 'object' ||
    value === null ||
    !('masterKeyProtection' in value) ||
    typeof value.masterKeyProtection !== 'object' ||
    value.masterKeyProtection === null ||
    !('profile' in value.masterKeyProtection) ||
    typeof value.masterKeyProtection.profile !== 'string' ||
    value.masterKeyProtection.profile.length < 1 ||
    value.masterKeyProtection.profile.length > 128
  ) {
    throw new RunnerReleaseError(
      'release_state_unsupported',
      'The Local Secret Vault header is invalid.',
    );
  }
  return {
    schemaVersion,
    protectionProfile: value.masterKeyProtection.profile,
  };
}

export async function inspectInstalledRunnerState(dataRoot: string): Promise<{
  currentLocalStateSchemaVersion: number;
  currentLocalSecretVault: InstalledVaultState | null;
}> {
  const stateDirectory = join(dataRoot, '.tasktwin');
  const directory = await lstat(stateDirectory).catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (
    directory !== null &&
    (!directory.isDirectory() || directory.isSymbolicLink())
  ) {
    throw new RunnerReleaseError(
      'release_state_unsupported',
      'Persisted Runner state cannot be inspected safely.',
    );
  }
  const stateHeaders = await Promise.all(
    ['runner-credential.json', 'runner-encryption-key.json'].map((name) =>
      readRegularJson(join(stateDirectory, name), MAX_LOCAL_STATE_HEADER_BYTES),
    ),
  );
  for (const state of stateHeaders) {
    if (
      state !== null &&
      schemaVersionOf(state) !== LOCAL_RUNNER_STATE_SCHEMA_VERSION
    ) {
      throw new RunnerReleaseError(
        'release_state_unsupported',
        'The persisted Runner-state schema is unsupported.',
      );
    }
  }
  const vault = await readRegularJson(
    join(stateDirectory, 'local-secret-vault.v1.json'),
    MAX_LOCAL_VAULT_FILE_BYTES,
  );
  return {
    currentLocalStateSchemaVersion: LOCAL_RUNNER_STATE_SCHEMA_VERSION,
    currentLocalSecretVault: vaultStateOf(vault),
  };
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
