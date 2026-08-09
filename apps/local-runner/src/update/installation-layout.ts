import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { ProductSemVerSchema, Sha256HexSchema } from '@tasktwin/runner-release';
import { z } from 'zod';

const RunnerIdSchema = z.string().uuid();

export interface RunnerInstallationPaths {
  readonly root: string;
  readonly releases: string;
  readonly staging: string;
  readonly updateLock: string;
  readonly activeRelease: string;
  readonly journal: string;
  readonly runtime: string;
  readonly startupStatus: string;
  readonly logs: string;
}

export interface InstalledReleasePaths {
  readonly root: string;
  readonly record: string;
  readonly manifest: string;
  readonly signature: string;
  readonly artifact: string;
  readonly payload: string;
  readonly activation: string;
}

export interface StagedReleasePaths extends InstalledReleasePaths {
  readonly stagingRoot: string;
}

export function runnerInstallationPaths(input: {
  programData: string;
  runnerDeviceId: string;
}): RunnerInstallationPaths {
  const programData = requireAbsolutePath(input.programData);
  const runnerDeviceId = RunnerIdSchema.parse(input.runnerDeviceId);
  const root = containedPath(
    programData,
    join(
      programData,
      'TaskTwin',
      'RunnerInstallations',
      runnerDeviceId.toLowerCase(),
    ),
  );
  const runtime = containedPath(root, join(root, 'runtime'));
  return {
    root,
    releases: containedPath(root, join(root, 'releases')),
    staging: containedPath(root, join(root, 'staging')),
    updateLock: containedPath(root, join(root, 'locks', 'update')),
    activeRelease: containedPath(root, join(root, 'active-release.v1.json')),
    journal: containedPath(root, join(root, 'update-journal.v1.json')),
    runtime,
    startupStatus: containedPath(
      runtime,
      join(runtime, 'startup-status.v1.json'),
    ),
    logs: containedPath(runtime, join(runtime, 'logs')),
  };
}

export function installedReleaseDirectoryName(input: {
  version: string;
  manifestSha256: string;
}): string {
  const version = ProductSemVerSchema.parse(input.version);
  const digest = Sha256HexSchema.parse(input.manifestSha256);
  return `${version}-${digest.slice(0, 32)}`;
}

export function installedReleaseDirectory(
  paths: RunnerInstallationPaths,
  input: { version: string; manifestSha256: string },
): string {
  return containedPath(
    paths.releases,
    join(paths.releases, installedReleaseDirectoryName(input)),
  );
}

export function installedReleasePaths(
  paths: RunnerInstallationPaths,
  input: { version: string; manifestSha256: string; artifactFileName: string },
): InstalledReleasePaths {
  const root = installedReleaseDirectory(paths, input);
  return releasePaths(root, input.artifactFileName);
}

export function stagedReleasePaths(
  paths: RunnerInstallationPaths,
  input: {
    updateId: string;
    artifactFileName: string;
  },
): StagedReleasePaths {
  const stagingRoot = updateStagingDirectory(paths, input.updateId);
  return {
    stagingRoot,
    ...releasePaths(stagingRoot, input.artifactFileName),
  };
}

export function updateStagingDirectory(
  paths: RunnerInstallationPaths,
  updateId: string,
): string {
  if (!/^ru1_[a-f0-9]{64}$/.test(updateId)) {
    throw new Error('The Runner update ID is invalid.');
  }
  return containedPath(paths.staging, join(paths.staging, updateId));
}

export function runnerActivationExecutableName(runnerDeviceId: string): string {
  return `TaskTwinRunner_${RunnerIdSchema.parse(runnerDeviceId).replaceAll('-', '')}.exe`;
}

function releasePaths(
  root: string,
  artifactFileName: string,
): InstalledReleasePaths {
  if (
    artifactFileName.includes('/') ||
    artifactFileName.includes('\\') ||
    artifactFileName === '.' ||
    artifactFileName === '..' ||
    artifactFileName.includes('\0')
  ) {
    throw new Error('The Runner release artifact file name is invalid.');
  }
  const proof = containedPath(root, join(root, 'proof'));
  return {
    root,
    record: containedPath(root, join(root, 'installed-release.v1.json')),
    manifest: containedPath(proof, join(proof, 'release-manifest.json')),
    signature: containedPath(proof, join(proof, 'release-signature.json')),
    artifact: containedPath(proof, join(proof, artifactFileName)),
    payload: containedPath(root, join(root, 'payload')),
    activation: containedPath(root, join(root, 'activation')),
  };
}

export function containedPath(root: string, candidate: string): string {
  const resolvedRoot = requireAbsolutePath(root);
  const resolvedCandidate = requireAbsolutePath(candidate);
  const relation = relative(resolvedRoot, resolvedCandidate);
  if (
    relation === '' ||
    relation === '..' ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    throw new Error(
      'The Runner installation path escapes its controlled root.',
    );
  }
  return resolvedCandidate;
}

function requireAbsolutePath(value: string): string {
  if (!isAbsolute(value) || value.includes('\0')) {
    throw new Error('The Runner installation path must be absolute.');
  }
  return resolve(value);
}
