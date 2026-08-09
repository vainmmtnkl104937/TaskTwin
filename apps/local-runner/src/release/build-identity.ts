import { lstat, readFile } from 'node:fs/promises';

import {
  RunnerBuildIdentitySchema,
  RunnerSoftwareIdentitySchema,
  type RunnerBuildIdentity,
  type RunnerSoftwareIdentity,
} from '@tasktwin/runner-release';

const MAX_BUILD_IDENTITY_BYTES = 8 * 1024;

export async function readEmbeddedBuildIdentity(
  identityUrl = new URL('./build-identity.json', import.meta.url),
): Promise<RunnerBuildIdentity> {
  try {
    const file = await lstat(identityUrl);
    if (
      !file.isFile() ||
      file.isSymbolicLink() ||
      file.size < 1 ||
      file.size > MAX_BUILD_IDENTITY_BYTES
    ) {
      throw new Error('invalid file');
    }
    return RunnerBuildIdentitySchema.parse(
      JSON.parse(await readFile(identityUrl, 'utf8')) as unknown,
    );
  } catch {
    throw new Error('The installed Runner build identity is invalid.');
  }
}

export function reportedSoftwareIdentity(
  identity: RunnerBuildIdentity,
): RunnerSoftwareIdentity {
  return RunnerSoftwareIdentitySchema.parse({
    product: identity.product,
    version: identity.version,
    runnerProtocolVersion: identity.runnerProtocolVersion,
    workflowSchemaVersion: identity.workflowSchemaVersion,
    localStateSchemaVersion: identity.localStateSchemaVersion,
    platform: identity.platform,
    architecture: identity.architecture,
  });
}

export function formatRunnerVersion(identity: RunnerBuildIdentity): string {
  return [
    `${identity.product} ${identity.version}`,
    `source commit: ${identity.sourceCommit}`,
    `target: ${identity.platform}/${identity.architecture}`,
    `Runner protocol: ${identity.runnerProtocolVersion}`,
    `Workflow schema: ${identity.workflowSchemaVersion}`,
    `local state schema: ${identity.localStateSchemaVersion}`,
    `Local Secret Vault schema: ${identity.localSecretVaultSchemaVersion}`,
  ].join('\n');
}
