import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LOCAL_SECRET_MASTER_KEY_PROFILE,
  LOCAL_SECRET_STORE_SCHEMA_VERSION,
  WINDOWS_NATIVE_MASTER_KEY_PROFILE,
} from '@tasktwin/local-secret-store';
import { RUN_PROTOCOL_VERSION } from '@tasktwin/run-protocol';
import {
  LOCAL_RUNNER_STATE_SCHEMA_VERSION,
  RUNNER_RELEASE_ARCHITECTURE,
  RUNNER_RELEASE_PLATFORM,
  ReleaseManifestSchema,
  RunnerBuildIdentitySchema,
  canonicalizeReleaseManifest,
  expectedRunnerArtifactFileName,
} from '@tasktwin/runner-release';
import { WORKFLOW_SCHEMA_VERSION } from '@tasktwin/workflow-schema';

import {
  parseOptions,
  readRegularJson,
  sha256File,
  writeNewFile,
} from './release-script-utils.mjs';

export async function generateReleaseManifest(input) {
  const identity = RunnerBuildIdentitySchema.parse(
    await readRegularJson(input.buildIdentityPath),
  );
  const artifact = await stat(input.artifactPath);
  if (!artifact.isFile() || artifact.isSymbolicLink() || artifact.size < 1) {
    throw new Error('The release artifact must be a non-empty regular file.');
  }
  const expectedName = expectedRunnerArtifactFileName(
    identity.version,
    RUNNER_RELEASE_PLATFORM,
    RUNNER_RELEASE_ARCHITECTURE,
  );
  if (
    input.artifactPath.replaceAll('\\', '/').split('/').at(-1) !== expectedName
  ) {
    throw new Error('The deterministic release artifact name is invalid.');
  }
  if (
    identity.runnerProtocolVersion !== RUN_PROTOCOL_VERSION ||
    identity.workflowSchemaVersion !== WORKFLOW_SCHEMA_VERSION ||
    identity.localStateSchemaVersion !== LOCAL_RUNNER_STATE_SCHEMA_VERSION ||
    identity.localSecretVaultSchemaVersion !== LOCAL_SECRET_STORE_SCHEMA_VERSION
  ) {
    throw new Error(
      'The embedded build compatibility metadata is inconsistent.',
    );
  }
  const manifest = ReleaseManifestSchema.parse({
    schemaVersion: 1,
    product: identity.product,
    version: identity.version,
    channel: 'stable',
    sourceCommit: identity.sourceCommit,
    builtAt: new Date(input.builtAt).toISOString(),
    compatibility: {
      runnerProtocolVersion: RUN_PROTOCOL_VERSION,
      workflowSchema: {
        readable: {
          min: WORKFLOW_SCHEMA_VERSION,
          max: WORKFLOW_SCHEMA_VERSION,
        },
      },
      localState: {
        readableSchemas: [LOCAL_RUNNER_STATE_SCHEMA_VERSION],
        writableSchema: LOCAL_RUNNER_STATE_SCHEMA_VERSION,
      },
      localSecretVault: {
        readableSchemas: [LOCAL_SECRET_STORE_SCHEMA_VERSION],
        writableSchema: LOCAL_SECRET_STORE_SCHEMA_VERSION,
        readableProtectionProfiles: [
          LOCAL_SECRET_MASTER_KEY_PROFILE,
          WINDOWS_NATIVE_MASTER_KEY_PROFILE,
        ].sort(),
      },
    },
    artifacts: [
      {
        platform: RUNNER_RELEASE_PLATFORM,
        architecture: RUNNER_RELEASE_ARCHITECTURE,
        fileName: expectedName,
        archiveFormat: 'zip',
        sizeBytes: artifact.size,
        sha256: await sha256File(input.artifactPath),
      },
    ],
    signingKeyId: input.signingKeyId,
  });
  await writeNewFile(
    input.outputPath,
    `${canonicalizeReleaseManifest(manifest)}\n`,
  );
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseOptions(process.argv.slice(2), {
    '--build-identity': true,
    '--artifact': true,
    '--built-at': true,
    '--signing-key-id': true,
    '--output': true,
  });
  const manifest = await generateReleaseManifest({
    buildIdentityPath: resolve(options['--build-identity']),
    artifactPath: resolve(options['--artifact']),
    builtAt: options['--built-at'],
    signingKeyId: options['--signing-key-id'],
    outputPath: resolve(options['--output']),
  });
  process.stdout.write(`${manifest.version}\n`);
}
