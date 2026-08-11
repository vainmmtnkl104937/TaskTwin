import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  Sha256HexSchema,
  type ReleaseArtifactDescriptor,
} from '@tasktwin/runner-release';

export interface ReleaseCachePaths {
  readonly root: string;
  readonly partial: string;
  readonly verified: string;
  readonly locks: string;
}

export interface PartialReleaseCachePaths {
  readonly root: string;
  readonly state: string;
  readonly manifest: string;
  readonly signature: string;
  readonly artifact: string;
  readonly lock: string;
}

export interface VerifiedReleaseCachePaths {
  readonly root: string;
  readonly record: string;
  readonly manifest: string;
  readonly signature: string;
  readonly artifact: string;
}

export function releaseCachePaths(dataRoot: string): ReleaseCachePaths {
  if (!isAbsolute(dataRoot) || dataRoot.includes('\0')) {
    throw new Error('The release cache data root must be absolute.');
  }
  const root = resolve(dataRoot, '.tasktwin', 'release-cache', 'v1');
  return {
    root,
    partial: contained(root, join(root, 'partial')),
    verified: contained(root, join(root, 'verified')),
    locks: contained(root, join(root, 'locks')),
  };
}

export function partialReleaseCachePaths(
  paths: ReleaseCachePaths,
  manifestSha256: string,
): PartialReleaseCachePaths {
  const digest = Sha256HexSchema.parse(manifestSha256);
  const root = contained(paths.partial, join(paths.partial, digest));
  return {
    root,
    state: contained(root, join(root, 'acquisition-state.v1.json')),
    manifest: contained(root, join(root, 'release-manifest.json')),
    signature: contained(root, join(root, 'release-signature.json')),
    artifact: contained(root, join(root, 'artifact.part')),
    lock: contained(paths.locks, join(paths.locks, digest)),
  };
}

export function verifiedReleaseCachePaths(
  paths: ReleaseCachePaths,
  manifestSha256: string,
  artifact: ReleaseArtifactDescriptor,
): VerifiedReleaseCachePaths {
  const digest = Sha256HexSchema.parse(manifestSha256);
  requireLeaf(artifact.fileName);
  const root = contained(paths.verified, join(paths.verified, digest));
  return {
    root,
    record: contained(root, join(root, 'cached-release.v1.json')),
    manifest: contained(root, join(root, 'release-manifest.json')),
    signature: contained(root, join(root, 'release-signature.json')),
    artifact: contained(root, join(root, artifact.fileName)),
  };
}

function contained(root: string, candidate: string): string {
  const resolvedRoot = resolve(root);
  const resolved = resolve(candidate);
  const relation = relative(resolvedRoot, resolved);
  if (
    relation === '' ||
    relation === '..' ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    throw new Error('The release cache path escapes its controlled root.');
  }
  return resolved;
}

function requireLeaf(value: string): void {
  if (
    value.length < 1 ||
    value.length > 255 ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('\0') ||
    value === '.' ||
    value === '..'
  ) {
    throw new Error('The release cache artifact name is invalid.');
  }
}
