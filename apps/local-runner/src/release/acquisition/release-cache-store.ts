import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  unlink,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  CachedRunnerReleaseSchema,
  MAX_RELEASE_CACHE_ENTRIES,
  PartialReleaseAcquisitionSchema,
  RunnerAcquisitionError,
  summarizeCachedRelease,
  type CachedRunnerRelease,
  type PartialReleaseAcquisition,
  type SafeCachedReleaseSummary,
} from '@tasktwin/runner-acquisition';
import {
  deriveRunnerReleaseId,
  type TrustedReleaseKey,
  type VerifiedRelease,
  type VerifiedReleaseManifest,
} from '@tasktwin/runner-release';
import lockfile from 'proper-lockfile';

import { verifyReleaseFiles } from '../release-file-verifier.js';
import { AtomicJsonStore } from '../../update/atomic-json-store.js';
import {
  assertControlledDirectoryChain,
  ensureControlledDirectory,
} from '../../update/controlled-directory.js';
import {
  partialReleaseCachePaths,
  releaseCachePaths,
  verifiedReleaseCachePaths,
  type PartialReleaseCachePaths,
  type ReleaseCachePaths,
} from './release-cache-layout.js';

export interface VerifiedCachedRelease {
  readonly record: CachedRunnerRelease;
  readonly release: VerifiedRelease;
  readonly manifestPath: string;
  readonly signaturePath: string;
  readonly artifactPath: string;
}

export interface PartialCacheObservation {
  readonly record: PartialReleaseAcquisition | null;
  readonly paths: PartialReleaseCachePaths;
  readonly actualBytes: number;
}

export interface ReleaseCacheLease {
  release(): Promise<void>;
}

export class FileReleaseCacheStore {
  readonly paths: ReleaseCachePaths;

  constructor(
    dataRoot: string,
    private readonly trustedKeys: readonly TrustedReleaseKey[],
  ) {
    this.paths = releaseCachePaths(dataRoot);
  }

  async acquire(manifestSha256: string): Promise<ReleaseCacheLease> {
    const paths = partialReleaseCachePaths(this.paths, manifestSha256);
    await ensureControlledDirectory(dirname(paths.lock));
    await ensureControlledDirectory(paths.lock);
    let release: (() => Promise<void>) | null = null;
    try {
      release = await lockfile.lock(paths.lock, {
        realpath: false,
        stale: 2 * 60 * 60 * 1_000,
        update: 30_000,
        retries: { retries: 0 },
      });
      await assertControlledDirectoryChain(paths.lock);
      let active = true;
      return {
        release: async () => {
          if (!active) return;
          active = false;
          await release?.().catch(() => undefined);
        },
      };
    } catch {
      await release?.().catch(() => undefined);
      throw new RunnerAcquisitionError(
        'acquisition_cache_conflict',
        'Another acquisition of this release is already in progress.',
      );
    }
  }

  async findVerified(
    manifestSha256: string,
  ): Promise<VerifiedCachedRelease | null> {
    const provisionalRoot = verifiedReleaseCachePaths(
      this.paths,
      manifestSha256,
      {
        platform: 'windows',
        architecture: 'x64',
        fileName: 'placeholder.zip',
        archiveFormat: 'zip',
        sizeBytes: 1,
        sha256: '0'.repeat(64),
      },
    ).root;
    const rootStat = await lstatOrNull(provisionalRoot);
    if (rootStat === null) return null;
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw cacheInvalid();
    }
    const recordPath = join(provisionalRoot, 'cached-release.v1.json');
    const record = await new AtomicJsonStore(
      recordPath,
      CachedRunnerReleaseSchema,
    ).read();
    if (record === null || record.manifestSha256 !== manifestSha256) {
      throw cacheInvalid();
    }
    return this.verifyRecord(record);
  }

  async observePartial(
    manifestSha256: string,
  ): Promise<PartialCacheObservation> {
    const paths = partialReleaseCachePaths(this.paths, manifestSha256);
    const root = await lstatOrNull(paths.root);
    if (root === null) return { record: null, paths, actualBytes: 0 };
    if (!root.isDirectory() || root.isSymbolicLink()) throw cacheInvalid();
    const record = await new AtomicJsonStore(
      paths.state,
      PartialReleaseAcquisitionSchema,
    ).read();
    const artifact = await lstatOrNull(paths.artifact);
    if (
      record === null ||
      artifact === null ||
      !artifact.isFile() ||
      artifact.isSymbolicLink()
    ) {
      throw cacheInvalid();
    }
    return { record, paths, actualBytes: artifact.size };
  }

  async initializePartial(input: {
    record: PartialReleaseAcquisition;
    manifestBytes: Uint8Array;
    signatureBytes: Uint8Array;
  }): Promise<PartialReleaseCachePaths> {
    const record = PartialReleaseAcquisitionSchema.parse(input.record);
    await this.removePartial(record.manifestSha256);
    await ensureControlledDirectory(this.paths.partial);
    const paths = partialReleaseCachePaths(this.paths, record.manifestSha256);
    await mkdir(paths.root, { recursive: false, mode: 0o700 });
    try {
      await writeBytesAtomic(paths.manifest, input.manifestBytes, true);
      await writeBytesAtomic(paths.signature, input.signatureBytes, true);
      const artifact = await open(paths.artifact, 'wx', 0o600);
      await artifact.sync();
      await artifact.close();
      await new AtomicJsonStore(
        paths.state,
        PartialReleaseAcquisitionSchema,
      ).create(record);
      return paths;
    } catch (error: unknown) {
      await this.removePartial(record.manifestSha256).catch(() => undefined);
      throw error;
    }
  }

  async replacePartialProof(input: {
    manifestSha256: string;
    manifestBytes: Uint8Array;
    signatureBytes: Uint8Array;
  }): Promise<void> {
    const paths = partialReleaseCachePaths(this.paths, input.manifestSha256);
    await assertControlledDirectoryChain(paths.root);
    await writeBytesAtomic(paths.manifest, input.manifestBytes, false);
    await writeBytesAtomic(paths.signature, input.signatureBytes, false);
  }

  async updatePartial(record: PartialReleaseAcquisition): Promise<void> {
    const parsed = PartialReleaseAcquisitionSchema.parse(record);
    const paths = partialReleaseCachePaths(this.paths, parsed.manifestSha256);
    await new AtomicJsonStore(
      paths.state,
      PartialReleaseAcquisitionSchema,
    ).replace(parsed);
  }

  async promote(input: {
    verifiedManifest: VerifiedReleaseManifest;
    record: CachedRunnerRelease;
  }): Promise<VerifiedCachedRelease> {
    const record = CachedRunnerReleaseSchema.parse(input.record);
    const partial = partialReleaseCachePaths(
      this.paths,
      input.verifiedManifest.manifestSha256,
    );
    const verified = verifiedReleaseCachePaths(
      this.paths,
      input.verifiedManifest.manifestSha256,
      record.artifact,
    );
    const existing = await this.findVerified(record.manifestSha256);
    if (existing !== null) {
      await this.removePartial(record.manifestSha256);
      return existing;
    }
    await assertControlledDirectoryChain(partial.root);
    await rename(
      partial.artifact,
      join(partial.root, record.artifact.fileName),
    );
    await new AtomicJsonStore(
      join(partial.root, 'cached-release.v1.json'),
      CachedRunnerReleaseSchema,
    ).create(record);
    const release = await verifyReleaseFiles({
      manifestPath: partial.manifest,
      signaturePath: partial.signature,
      artifactPath: join(partial.root, record.artifact.fileName),
      trustedKeys: this.trustedKeys,
    });
    assertRecordMatchesRelease(record, release);
    await unlink(partial.state);
    await ensureControlledDirectory(this.paths.verified);
    try {
      await rename(partial.root, verified.root);
      await syncDirectoryBestEffort(this.paths.verified);
    } catch {
      const concurrent = await this.findVerified(record.manifestSha256);
      if (concurrent !== null) {
        await this.removePartial(record.manifestSha256).catch(() => undefined);
        return concurrent;
      }
      throw new RunnerAcquisitionError(
        'acquisition_promotion_failed',
        'The verified release cache promotion failed.',
      );
    }
    return {
      record,
      release,
      manifestPath: verified.manifest,
      signaturePath: verified.signature,
      artifactPath: verified.artifact,
    };
  }

  async removePartial(manifestSha256: string): Promise<void> {
    const paths = partialReleaseCachePaths(this.paths, manifestSha256);
    const existing = await lstatOrNull(paths.root);
    if (existing === null) return;
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw cacheInvalid();
    }
    await assertControlledDirectoryChain(dirname(paths.root));
    await rm(paths.root, { recursive: true, force: false });
  }

  async list(): Promise<SafeCachedReleaseSummary[]> {
    const entries = await listDirectories(this.paths.verified);
    if (entries.length > MAX_RELEASE_CACHE_ENTRIES) throw cacheInvalid();
    const summaries: SafeCachedReleaseSummary[] = [];
    for (const entry of entries) {
      const cached = await this.findVerified(entry);
      if (cached === null) throw cacheInvalid();
      summaries.push(summarizeCachedRelease(cached.record));
    }
    return summaries.sort((left, right) =>
      left.version.localeCompare(right.version),
    );
  }

  async status(): Promise<{
    readonly verifiedCount: number;
    readonly partialCount: number;
  }> {
    const verified = await this.list();
    const partial = await listDirectories(this.paths.partial);
    if (partial.length > MAX_RELEASE_CACHE_ENTRIES) throw cacheInvalid();
    return { verifiedCount: verified.length, partialCount: partial.length };
  }

  private async verifyRecord(
    record: CachedRunnerRelease,
  ): Promise<VerifiedCachedRelease> {
    const paths = verifiedReleaseCachePaths(
      this.paths,
      record.manifestSha256,
      record.artifact,
    );
    try {
      const release = await verifyReleaseFiles({
        manifestPath: paths.manifest,
        signaturePath: paths.signature,
        artifactPath: paths.artifact,
        trustedKeys: this.trustedKeys,
      });
      assertRecordMatchesRelease(record, release);
      return {
        record,
        release,
        manifestPath: paths.manifest,
        signaturePath: paths.signature,
        artifactPath: paths.artifact,
      };
    } catch {
      throw cacheInvalid();
    }
  }
}

function assertRecordMatchesRelease(
  record: CachedRunnerRelease,
  release: VerifiedRelease,
): void {
  if (
    record.releaseId !== deriveRunnerReleaseId(release.manifestSha256) ||
    record.manifestSha256 !== release.manifestSha256 ||
    record.version !== release.manifest.version ||
    JSON.stringify(record.artifact) !== JSON.stringify(release.artifact)
  ) {
    throw cacheInvalid();
  }
}

async function writeBytesAtomic(
  path: string,
  bytes: Uint8Array,
  createOnly: boolean,
): Promise<void> {
  await ensureControlledDirectory(dirname(path));
  const existing = await lstatOrNull(path);
  if (createOnly && existing !== null) throw cacheInvalid();
  if (existing !== null && (!existing.isFile() || existing.isSymbolicLink())) {
    throw cacheInvalid();
  }
  const temporary = join(dirname(path), `.acquisition-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    await assertControlledDirectoryChain(dirname(path));
    await rename(temporary, path);
    await syncDirectoryBestEffort(dirname(path));
  } catch (error: unknown) {
    await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function listDirectories(path: string): Promise<string[]> {
  const root = await lstatOrNull(path);
  if (root === null) return [];
  if (!root.isDirectory() || root.isSymbolicLink()) throw cacheInvalid();
  const entries = await readdir(path, { withFileTypes: true });
  if (entries.some((entry) => !entry.isDirectory() || entry.isSymbolicLink())) {
    throw cacheInvalid();
  }
  return entries.map((entry) => entry.name);
}

async function syncDirectoryBestEffort(directory: string): Promise<void> {
  const handle = await open(directory, 'r').catch(() => null);
  if (handle === null) return;
  try {
    await handle.sync().catch(() => undefined);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function lstatOrNull(path: string) {
  return lstat(path).catch((error: unknown) =>
    isMissing(error) ? null : Promise.reject(error),
  );
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

function cacheInvalid(): RunnerAcquisitionError {
  return new RunnerAcquisitionError(
    'acquisition_cache_invalid',
    'The local verified release cache is invalid.',
  );
}
