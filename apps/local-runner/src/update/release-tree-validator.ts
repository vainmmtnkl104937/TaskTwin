import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';

import {
  RunnerBuildIdentitySchema,
  type VerifiedRelease,
} from '@tasktwin/runner-release';
import { z } from 'zod';

const RootPackageSchema = z.strictObject({
  name: z.literal('@tasktwin/local-runner'),
  version: z.string(),
  private: z.literal(true),
  type: z.literal('module'),
  main: z.literal('./dist/index.js'),
  engines: z.strictObject({ node: z.string() }).optional(),
});

const ALLOWED_ROOT_FILES = new Set(['package.json', 'runner.cmd']);
const ALLOWED_ROOT_DIRECTORIES = new Set([
  'browsers',
  'dist',
  'node_modules',
  'runtime',
  'windows',
]);
const FORBIDDEN_SEGMENTS = new Set([
  '.git',
  '.tasktwin',
  '.turbo',
  '__tests__',
  'browser-profile',
  'coverage',
  'fixtures',
  'profiles',
  'src',
  'storage-state',
  'test',
  'tests',
  'user-data',
]);
const FORBIDDEN_FILE_NAMES = [
  /^\.env(?:\..*)?$/i,
  /^local-secret-vault(?:\..*)?$/i,
  /^runner-credential\.json$/i,
  /^runner-encryption-key\.json$/i,
  /^runner-service(?:\..*)?\.json$/i,
  /storage-?state/i,
  /cookies?\.json$/i,
  /private[-_.]?key/i,
  /signing[-_.]?key/i,
  /\.pem$/i,
  /\.key$/i,
  /\.map$/i,
];
const PROHIBITED_CONTENT = [
  ['UPDATE', 'SECRET', 'LEAK', '32'].join('_'),
  ['UPDATE', 'CREDENTIAL', 'LEAK', '32'].join('_'),
  ['UPDATE', 'PROTECTED', 'KEY', 'LEAK', '32'].join('_'),
  ['LOCAL', 'SECRET', 'STORE', 'LEAK', '31'].join('_'),
  ['RUNNER', 'CREDENTIAL', 'LEAK', '31'].join('_'),
  ['RELEASE', 'PRIVATE', 'KEY', 'LEAK', '31'].join('_'),
  ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' '),
];
const REQUIRED_FILES = [
  'package.json',
  'runner.cmd',
  'dist/index.js',
  'dist/release/build-identity.json',
  'dist/platform/windows/windows-native-bridge.ps1',
  'dist/platform/windows/windows-runner-installation-acl.ps1',
  'dist/update/windows-release-archive.ps1',
  'runtime/node.exe',
  'runtime/LICENSE',
  'windows/THIRD_PARTY_NOTICES.md',
  'windows/vendor/winsw-2.12.0/WinSW.NET461.exe',
];
const MAXIMUM_FILES = 10_000;
const MAXIMUM_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;

export interface ValidatedReleaseTree {
  readonly rootDirectory: string;
  readonly fileCount: number;
  readonly totalBytes: number;
}

export async function validateExtractedReleaseTree(input: {
  extractionDirectory: string;
  verifiedRelease: VerifiedRelease;
}): Promise<ValidatedReleaseTree> {
  const expectedRootName = input.verifiedRelease.artifact.fileName.slice(0, -4);
  const extractionDirectory = resolve(input.extractionDirectory);
  const rootDirectory = resolve(extractionDirectory, expectedRootName);
  if (relative(extractionDirectory, rootDirectory).split(sep).includes('..')) {
    throw new Error('The extracted release root is invalid.');
  }
  const extractionEntries = await readdir(extractionDirectory, {
    withFileTypes: true,
  });
  if (
    extractionEntries.length !== 1 ||
    extractionEntries[0]?.name !== expectedRootName ||
    !extractionEntries[0].isDirectory()
  ) {
    throw new Error('The release must contain exactly one expected root.');
  }
  const rootStat = await lstat(rootDirectory);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('The extracted release root is unsafe.');
  }

  const files = new Set<string>();
  let totalBytes = 0;
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const stat = await lstat(path);
      const relativeName = relative(rootDirectory, path).split(sep).join('/');
      const segments = relativeName.split('/');
      if (
        stat.isSymbolicLink() ||
        segments.some((segment) =>
          FORBIDDEN_SEGMENTS.has(segment.toLowerCase()),
        ) ||
        FORBIDDEN_FILE_NAMES.some((pattern) => pattern.test(entry.name))
      ) {
        throw new Error(
          'The release staging tree contains prohibited content.',
        );
      }
      const rootName = segments[0]?.toLowerCase() ?? '';
      if (segments.length === 1) {
        if (
          (stat.isDirectory() && !ALLOWED_ROOT_DIRECTORIES.has(rootName)) ||
          (stat.isFile() && !ALLOWED_ROOT_FILES.has(rootName))
        ) {
          throw new Error(
            'The release staging tree contains a non-allowlisted root.',
          );
        }
      } else if (!ALLOWED_ROOT_DIRECTORIES.has(rootName)) {
        throw new Error(
          'The release staging tree contains a non-allowlisted root.',
        );
      }
      if (stat.isDirectory()) {
        await visit(path);
      } else if (stat.isFile()) {
        files.add(relativeName);
        totalBytes += stat.size;
        if (files.size > MAXIMUM_FILES || totalBytes > MAXIMUM_TOTAL_BYTES) {
          throw new Error(
            'The release staging tree exceeds its safety limits.',
          );
        }
        await assertNoProhibitedContent(path);
      } else {
        throw new Error(
          'The release staging tree contains a non-regular entry.',
        );
      }
    }
  }
  await visit(rootDirectory);

  for (const required of REQUIRED_FILES) {
    if (!files.has(required)) {
      throw new Error(`The release staging tree is missing ${required}.`);
    }
  }
  if (![...files].some((name) => /^browsers\/chromium-[0-9]+\//.test(name))) {
    throw new Error('The release staging tree is missing Chromium.');
  }
  if (
    ![...files].some((name) =>
      /^browsers\/chromium_headless_shell-[0-9]+\//.test(name),
    )
  ) {
    throw new Error(
      'The release staging tree is missing the Chromium headless shell.',
    );
  }

  const packageJson = RootPackageSchema.parse(
    JSON.parse(
      await readFile(join(rootDirectory, 'package.json'), 'utf8'),
    ) as unknown,
  );
  const identity = RunnerBuildIdentitySchema.parse(
    JSON.parse(
      await readFile(
        join(rootDirectory, 'dist', 'release', 'build-identity.json'),
        'utf8',
      ),
    ) as unknown,
  );
  const manifest = input.verifiedRelease.manifest;
  if (
    packageJson.version !== manifest.version ||
    identity.product !== manifest.product ||
    identity.version !== manifest.version ||
    identity.sourceCommit !== manifest.sourceCommit ||
    identity.platform !== input.verifiedRelease.artifact.platform ||
    identity.architecture !== input.verifiedRelease.artifact.architecture ||
    identity.runnerProtocolVersion !==
      manifest.compatibility.runnerProtocolVersion ||
    identity.workflowSchemaVersion <
      manifest.compatibility.workflowSchema.readable.min ||
    identity.workflowSchemaVersion >
      manifest.compatibility.workflowSchema.readable.max ||
    identity.localStateSchemaVersion !==
      manifest.compatibility.localState.writableSchema ||
    identity.localSecretVaultSchemaVersion !==
      manifest.compatibility.localSecretVault.writableSchema
  ) {
    throw new Error(
      'The staged Runner identity does not match the signed release.',
    );
  }

  return { rootDirectory, fileCount: files.size, totalBytes };
}

async function assertNoProhibitedContent(path: string): Promise<void> {
  const maximumNeedle = Math.max(
    ...PROHIBITED_CONTENT.map((value) => value.length),
  );
  const stream = createReadStream(path, { highWaterMark: 1024 * 1024 });
  let tail = Buffer.alloc(0);
  for await (const chunk of stream) {
    const data = Buffer.concat([tail, chunk as Buffer]);
    const text = data.toString('latin1');
    if (PROHIBITED_CONTENT.some((needle) => text.includes(needle))) {
      throw new Error(
        'The release staging tree contains prohibited fixture content.',
      );
    }
    tail = data.subarray(Math.max(0, data.length - maximumNeedle + 1));
  }
}

export function releasePayloadRootName(artifactFileName: string): string {
  return basename(artifactFileName, '.zip');
}
