import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import {
  RUNNER_RELEASE_ARCHITECTURE,
  RUNNER_RELEASE_PLATFORM,
  verifyRelease,
  type TrustedReleaseKey,
  type VerifiedRelease,
} from '@tasktwin/runner-release';

import { nodeReleaseVerificationCrypto } from './node-release-crypto.js';
import { TRUSTED_RUNNER_RELEASE_KEYS } from './trusted-release-keys.js';

const MAX_RELEASE_METADATA_BYTES = 256 * 1024;

async function readBoundedJson(path: string): Promise<unknown> {
  const file = await lstat(path);
  if (
    !file.isFile() ||
    file.isSymbolicLink() ||
    file.size < 1 ||
    file.size > MAX_RELEASE_METADATA_BYTES
  ) {
    throw new Error('Release metadata must be a bounded regular file.');
  }
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

async function sha256File(path: string): Promise<string> {
  const digest = createHash('sha256');
  const stream = createReadStream(path);
  for await (const chunk of stream) digest.update(chunk as Buffer);
  return digest.digest('hex');
}

export async function verifyReleaseFiles(input: {
  manifestPath: string;
  signaturePath: string;
  artifactPath: string;
  trustedKeys?: readonly TrustedReleaseKey[] | undefined;
}): Promise<VerifiedRelease> {
  const artifactFile = await lstat(input.artifactPath);
  if (
    !artifactFile.isFile() ||
    artifactFile.isSymbolicLink() ||
    artifactFile.size < 1
  ) {
    throw new Error('The release artifact must be a non-empty regular file.');
  }
  const [manifest, signature, artifactSha256] = await Promise.all([
    readBoundedJson(input.manifestPath),
    readBoundedJson(input.signaturePath),
    sha256File(input.artifactPath),
  ]);
  return verifyRelease({
    manifest,
    signature,
    trustedKeys: input.trustedKeys ?? TRUSTED_RUNNER_RELEASE_KEYS,
    crypto: nodeReleaseVerificationCrypto,
    artifact: {
      platform: RUNNER_RELEASE_PLATFORM,
      architecture: RUNNER_RELEASE_ARCHITECTURE,
      fileName: basename(input.artifactPath),
      sizeBytes: artifactFile.size,
      sha256: artifactSha256,
    },
  });
}
