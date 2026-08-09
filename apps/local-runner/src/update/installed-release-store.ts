import { constants as fsConstants } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
} from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';

import {
  type TrustedReleaseKey,
  type VerifiedRelease,
} from '@tasktwin/runner-release';
import {
  InstalledReleaseRecordSchema,
  deriveRunnerReleaseId,
  type InstalledReleaseRecord,
  type RunnerReleaseId,
  type RunnerUpdateId,
} from '@tasktwin/runner-update';

import { verifyReleaseFiles } from '../release/release-file-verifier.js';
import type { RunnerInstallationSecurityBoundary } from '../platform/windows/windows-runner-installation-acl.js';
import { WindowsReleaseArchiveExtractor } from './archive-extractor.js';
import { AtomicJsonStore } from './atomic-json-store.js';
import {
  containedPath,
  installedReleasePaths,
  stagedReleasePaths,
  updateStagingDirectory,
  type InstalledReleasePaths,
  type RunnerInstallationPaths,
} from './installation-layout.js';
import { validateExtractedReleaseTree } from './release-tree-validator.js';
import {
  assertControlledDirectoryChain,
  ensureControlledDirectory,
} from './controlled-directory.js';

const MAXIMUM_INSTALLED_RELEASES = 16;

export interface VerifiedInstalledRelease {
  readonly record: InstalledReleaseRecord;
  readonly release: VerifiedRelease;
  readonly paths: InstalledReleasePaths;
}

export interface StageVerifiedReleaseInput {
  readonly updateId: RunnerUpdateId;
  readonly verifiedRelease: VerifiedRelease;
  readonly manifestPath: string;
  readonly signaturePath: string;
  readonly artifactPath: string;
  readonly installedAt: string;
}

export class FileInstalledReleaseStore {
  constructor(
    private readonly paths: RunnerInstallationPaths,
    private readonly extractor: WindowsReleaseArchiveExtractor,
    private readonly trustedKeys: readonly TrustedReleaseKey[],
    private readonly securityBoundary?: RunnerInstallationSecurityBoundary,
  ) {}

  async stageAndCommit(
    input: StageVerifiedReleaseInput,
  ): Promise<VerifiedInstalledRelease> {
    const verified = input.verifiedRelease;
    const staging = stagedReleasePaths(this.paths, {
      updateId: input.updateId,
      artifactFileName: verified.artifact.fileName,
    });
    const installed = installedReleasePaths(this.paths, {
      version: verified.manifest.version,
      manifestSha256: verified.manifestSha256,
      artifactFileName: verified.artifact.fileName,
    });
    await assertAbsent(
      installed.root,
      'The target release is already installed.',
    );
    await ensureControlledDirectory(this.paths.staging);
    await mkdir(staging.root, { recursive: false, mode: 0o700 });
    await assertDirectoryContainsNoLink(staging.root);
    try {
      await ensureControlledDirectory(dirname(staging.manifest));
      for (const [source, target] of [
        [input.manifestPath, staging.manifest],
        [input.signaturePath, staging.signature],
        [input.artifactPath, staging.artifact],
      ] as const) {
        // Re-check the complete ancestor chain immediately before each write.
        // The controlled ProgramData ACL and exclusive update lease close the
        // remaining cross-process replacement surface after this validation.
        await assertControlledDirectoryChain(dirname(target));
        await copyRegularFileExclusive(source, target);
      }

      const copiedRelease = await this.verifyProof(staging);
      assertSameVerifiedRelease(verified, copiedRelease);
      await this.extractor.extract(staging.artifact, staging.payload);
      await validateExtractedReleaseTree({
        extractionDirectory: staging.payload,
        verifiedRelease: copiedRelease,
      });
      await this.extractor.compare(staging.artifact, staging.payload);

      // Re-hash and re-verify after extraction to close the mutable-input gap.
      const finalVerification = await this.verifyProof(staging);
      assertSameVerifiedRelease(verified, finalVerification);
      const record = installedRecord(finalVerification, input.installedAt);
      await new AtomicJsonStore(
        staging.record,
        InstalledReleaseRecordSchema,
      ).create(record);
      await this.securityBoundary?.protectAndValidate();
      const securedVerification = await this.verifyProof(staging);
      assertSameVerifiedRelease(finalVerification, securedVerification);
      await validateExtractedReleaseTree({
        extractionDirectory: staging.payload,
        verifiedRelease: securedVerification,
      });
      await this.extractor.compare(staging.artifact, staging.payload);

      await ensureControlledDirectory(this.paths.releases);
      await assertControlledDirectoryChain(staging.root);
      await rename(staging.root, installed.root);
      await syncDirectoryBestEffort(this.paths.releases);
      return { record, release: securedVerification, paths: installed };
    } catch (error: unknown) {
      await this.removeStaging(input.updateId).catch(() => undefined);
      throw error;
    }
  }

  async findVerified(
    releaseId: RunnerReleaseId,
  ): Promise<VerifiedInstalledRelease | null> {
    const records = await this.listRecordsWithPaths();
    const found = records.find(
      (candidate) => candidate.record.releaseId === releaseId,
    );
    if (found === undefined) return null;
    const release = await this.verifyProof(found.paths);
    assertRecordMatchesRelease(found.record, release);
    await validateExtractedReleaseTree({
      extractionDirectory: found.paths.payload,
      verifiedRelease: release,
    });
    await this.extractor.compare(found.paths.artifact, found.paths.payload);
    return { ...found, release };
  }

  async listRecords(): Promise<InstalledReleaseRecord[]> {
    return (await this.listRecordsWithPaths()).map(({ record }) => record);
  }

  async removeStaging(updateId: RunnerUpdateId): Promise<void> {
    const path = updateStagingDirectory(this.paths, updateId);
    await removeControlledDirectory(this.paths.staging, path);
  }

  async removeInstalled(releaseId: RunnerReleaseId): Promise<void> {
    const records = await this.listRecordsWithPaths();
    const found = records.find(
      (candidate) => candidate.record.releaseId === releaseId,
    );
    if (found === undefined) return;
    await removeControlledDirectory(this.paths.releases, found.paths.root);
  }

  private async verifyProof(
    paths: InstalledReleasePaths,
  ): Promise<VerifiedRelease> {
    return verifyReleaseFiles({
      manifestPath: paths.manifest,
      signaturePath: paths.signature,
      artifactPath: paths.artifact,
      trustedKeys: this.trustedKeys,
    });
  }

  private async listRecordsWithPaths(): Promise<
    Array<{ record: InstalledReleaseRecord; paths: InstalledReleasePaths }>
  > {
    const releasesDirectory = await lstat(this.paths.releases).catch(
      (error: unknown) => (isMissing(error) ? null : Promise.reject(error)),
    );
    if (releasesDirectory === null) return [];
    if (
      !releasesDirectory.isDirectory() ||
      releasesDirectory.isSymbolicLink()
    ) {
      throw new Error('The installed Runner release directory is invalid.');
    }
    const entries = await readdir(this.paths.releases, { withFileTypes: true });
    if (entries.length > MAXIMUM_INSTALLED_RELEASES) {
      throw new Error('Too many installed Runner releases were found.');
    }
    const records: Array<{
      record: InstalledReleaseRecord;
      paths: InstalledReleasePaths;
    }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new Error('The installed Runner release directory is invalid.');
      }
      const root = containedPath(
        this.paths.releases,
        resolve(this.paths.releases, entry.name),
      );
      const provisionalRecordPath = containedPath(
        root,
        resolve(root, 'installed-release.v1.json'),
      );
      const record = await new AtomicJsonStore(
        provisionalRecordPath,
        InstalledReleaseRecordSchema,
      ).read();
      if (record === null) {
        throw new Error('An installed Runner release record is missing.');
      }
      const paths = installedReleasePaths(this.paths, {
        version: record.version,
        manifestSha256: record.manifestSha256,
        artifactFileName: record.artifact.fileName,
      });
      if (resolve(paths.root) !== root) {
        throw new Error(
          'The installed Runner release directory name is invalid.',
        );
      }
      records.push({ record, paths });
    }
    return records;
  }
}

function installedRecord(
  release: VerifiedRelease,
  installedAt: string,
): InstalledReleaseRecord {
  return InstalledReleaseRecordSchema.parse({
    schemaVersion: 1,
    releaseId: deriveRunnerReleaseId(release.manifestSha256),
    product: release.manifest.product,
    version: release.manifest.version,
    sourceCommit: release.manifest.sourceCommit,
    platform: release.artifact.platform,
    architecture: release.artifact.architecture,
    signingKeyId: release.manifest.signingKeyId,
    manifestSha256: release.manifestSha256,
    artifact: release.artifact,
    installedAt,
  });
}

function assertSameVerifiedRelease(
  expected: VerifiedRelease,
  actual: VerifiedRelease,
): void {
  if (
    expected.manifestSha256 !== actual.manifestSha256 ||
    expected.artifact.sha256 !== actual.artifact.sha256 ||
    expected.artifact.sizeBytes !== actual.artifact.sizeBytes ||
    expected.artifact.fileName !== actual.artifact.fileName
  ) {
    throw new Error('The staged release proof changed after verification.');
  }
}

function assertRecordMatchesRelease(
  record: InstalledReleaseRecord,
  release: VerifiedRelease,
): void {
  const expected = installedRecord(release, record.installedAt);
  if (JSON.stringify(record) !== JSON.stringify(expected)) {
    throw new Error(
      'The installed release record does not match its signed proof.',
    );
  }
}

async function copyRegularFileExclusive(
  source: string,
  target: string,
): Promise<void> {
  const sourceStat = await lstat(source);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error('The release input must be a regular file.');
  }
  await copyFile(source, target, fsConstants.COPYFILE_EXCL);
  const copied = await lstat(target);
  if (!copied.isFile() || copied.isSymbolicLink()) {
    throw new Error('The staged release proof must be a regular file.');
  }
  const targetHandle = await open(target, 'r+');
  try {
    await targetHandle.sync();
  } finally {
    await targetHandle.close();
  }
}

async function assertDirectoryContainsNoLink(path: string): Promise<void> {
  const existing = await lstat(path);
  if (!existing.isDirectory() || existing.isSymbolicLink()) {
    throw new Error(
      'The Runner installation path contains a link or reparse point.',
    );
  }
}

async function removeControlledDirectory(
  root: string,
  path: string,
): Promise<void> {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  const relation = relative(resolvedRoot, resolvedPath);
  if (
    relation === '' ||
    relation === '..' ||
    relation.startsWith(`..${sep}`) ||
    basename(resolvedPath).length === 0
  ) {
    throw new Error('Refusing to remove a path outside the installation root.');
  }
  const stat = await lstat(resolvedPath).catch((error: unknown) =>
    isMissing(error) ? null : Promise.reject(error),
  );
  if (stat === null) return;
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('The controlled release directory is invalid.');
  }
  await assertTreeContainsNoLinks(resolvedPath);
  await rm(resolvedPath, { recursive: true, force: false });
}

async function assertAbsent(path: string, message: string): Promise<void> {
  const existing = await lstat(path).catch((error: unknown) =>
    isMissing(error) ? null : Promise.reject(error),
  );
  if (existing !== null) throw new Error(message);
}

async function assertTreeContainsNoLinks(root: string): Promise<void> {
  const pending = [root];
  let visited = 0;
  while (pending.length > 0) {
    const directory = pending.pop();
    if (directory === undefined) break;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      visited += 1;
      if (visited > 20_000) {
        throw new Error(
          'The controlled release tree is too large to remove safely.',
        );
      }
      const candidate = resolve(directory, entry.name);
      const stat = await lstat(candidate);
      if (stat.isSymbolicLink()) {
        throw new Error('The controlled release tree contains a link.');
      }
      if (stat.isDirectory()) pending.push(candidate);
      else if (!stat.isFile()) {
        throw new Error(
          'The controlled release tree contains a special entry.',
        );
      }
    }
  }
}

async function syncDirectoryBestEffort(path: string): Promise<void> {
  const handle = await open(path, 'r').catch(() => null);
  if (handle === null) return;
  try {
    await handle.sync().catch(() => undefined);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
