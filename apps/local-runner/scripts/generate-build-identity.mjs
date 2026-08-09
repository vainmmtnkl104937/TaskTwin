import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { LOCAL_SECRET_STORE_SCHEMA_VERSION } from '@tasktwin/local-secret-store';
import { RUN_PROTOCOL_VERSION } from '@tasktwin/run-protocol';
import {
  LOCAL_RUNNER_STATE_SCHEMA_VERSION,
  RUNNER_RELEASE_PRODUCT,
  RunnerBuildIdentitySchema,
} from '@tasktwin/runner-release';
import { WORKFLOW_SCHEMA_VERSION } from '@tasktwin/workflow-schema';

const run = promisify(execFile);
const applicationRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(applicationRoot, '..', '..');
const packageJson = JSON.parse(
  await readFile(resolve(applicationRoot, 'package.json'), 'utf8'),
);
const sourceCommit =
  process.env['TASKTWIN_SOURCE_COMMIT'] ??
  (
    await run('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot })
  ).stdout.trim();
const releasePlatform =
  process.platform === 'win32'
    ? 'windows'
    : process.platform === 'darwin'
      ? 'macos'
      : process.platform;
const identity = RunnerBuildIdentitySchema.parse({
  product: RUNNER_RELEASE_PRODUCT,
  version: packageJson.version,
  sourceCommit,
  platform: releasePlatform,
  architecture: process.arch,
  runnerProtocolVersion: RUN_PROTOCOL_VERSION,
  workflowSchemaVersion: WORKFLOW_SCHEMA_VERSION,
  localStateSchemaVersion: LOCAL_RUNNER_STATE_SCHEMA_VERSION,
  localSecretVaultSchemaVersion: LOCAL_SECRET_STORE_SCHEMA_VERSION,
});
await writeFile(
  resolve(applicationRoot, 'dist', 'release', 'build-identity.json'),
  `${JSON.stringify(identity)}\n`,
  { encoding: 'utf8', flag: 'wx' },
);
