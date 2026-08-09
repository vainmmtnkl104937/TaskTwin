import { createHash, generateKeyPairSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rm,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RUNNER_RELEASE_ARCHITECTURE,
  RUNNER_RELEASE_PLATFORM,
  evaluateUpgradePreflight,
  verifyRelease,
} from '@tasktwin/runner-release';

import { generateReleaseManifest } from './generate-release-manifest.mjs';
import { createDetachedReleaseSignature } from './sign-release-manifest.mjs';
import { inspectReleaseStaging } from './inspect-release-staging.mjs';
import {
  parseOptions,
  sha256File,
  writeNewFile,
} from './release-script-utils.mjs';
import { stageWindowsX64Release } from './stage-windows-x64.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const applicationRoot = resolve(scriptDirectory, '..', '..');

function invoke(executable, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            Buffer.concat(stderr).toString('utf8').trim() ||
              'The release subprocess failed.',
          ),
        );
        return;
      }
      resolveRun(Buffer.concat(stdout).toString('utf8'));
    });
  });
}

function verificationCrypto() {
  return {
    sha256Hex(value) {
      return createHash('sha256').update(value, 'utf8').digest('hex');
    },
    verifyEd25519(input) {
      const { createPublicKey, verify } = awaitCrypto;
      try {
        const publicKey = createPublicKey({
          key: Buffer.from(input.publicKeySpkiDerBase64Url, 'base64url'),
          format: 'der',
          type: 'spki',
        });
        return verify(
          null,
          Buffer.from(input.canonicalManifest, 'utf8'),
          publicKey,
          Buffer.from(input.signatureBase64Url, 'base64url'),
        );
      } catch {
        return false;
      }
    },
  };
}

function requireReleaseFailure(operation, expectedCode) {
  try {
    operation();
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === expectedCode
    ) {
      return true;
    }
    throw error;
  }
  throw new Error(
    `Release verification unexpectedly accepted ${expectedCode}.`,
  );
}

// Kept as a module binding so the verifier never reads key material from a
// manifest or environment variable during a dry run.
import * as awaitCrypto from 'node:crypto';

export async function runReleaseDryRun(input) {
  if (
    process.env['TASKTWIN_RUNNER_RELEASE_SIGNING_KEY_PKCS8_BASE64'] !==
    undefined
  ) {
    throw new Error(
      'A dry run refuses access to the production signing credential.',
    );
  }
  const outputDirectory = resolve(input.outputDirectory);
  if ((await lstat(outputDirectory).catch(() => null)) !== null) {
    throw new Error('The immutable dry-run output directory already exists.');
  }
  await mkdir(outputDirectory, { recursive: true });
  const workRoot = await mkdtemp(join(tmpdir(), 'tasktwin-runner-release-31-'));
  try {
    const stageParent = join(workRoot, 'staging');
    await mkdir(stageParent);
    const staged = await stageWindowsX64Release({
      outputDirectory: stageParent,
      browserSource: input.browserSource,
    });
    await inspectReleaseStaging(staged.stagingRoot);
    const artifactPath = join(outputDirectory, staged.archiveName);
    await invoke(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-File',
        join(scriptDirectory, 'package-windows-x64.ps1'),
        '-StagingDirectory',
        staged.stagingRoot,
        '-OutputFile',
        artifactPath,
      ],
      { cwd: applicationRoot, env: process.env },
    );
    await invoke(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-File',
        join(scriptDirectory, 'inspect-release-archive.ps1'),
        '-Artifact',
        artifactPath,
      ],
      { cwd: applicationRoot, env: process.env },
    );
    const keyId = 'runner-release-dry-run-ephemeral';
    const manifestPath = join(
      outputDirectory,
      `tasktwin-runner-${staged.identity.version}-release-manifest.json`,
    );
    const signaturePath = join(
      outputDirectory,
      `tasktwin-runner-${staged.identity.version}-release-signature.json`,
    );
    const manifest = await generateReleaseManifest({
      buildIdentityPath: join(
        staged.stagingRoot,
        'dist',
        'release',
        'build-identity.json',
      ),
      artifactPath,
      builtAt: input.builtAt,
      signingKeyId: keyId,
      outputPath: manifestPath,
    });
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const signature = createDetachedReleaseSignature({
      manifest,
      keyId,
      privateKey,
    });
    await writeNewFile(signaturePath, `${JSON.stringify(signature)}\n`);
    const artifact = await stat(artifactPath);
    const trustedKeys = [
      {
        keyId,
        algorithm: 'Ed25519',
        publicKeySpkiDerBase64Url: publicKey
          .export({ format: 'der', type: 'spki' })
          .toString('base64url'),
      },
    ];
    const observedArtifact = {
      platform: RUNNER_RELEASE_PLATFORM,
      architecture: RUNNER_RELEASE_ARCHITECTURE,
      fileName: staged.archiveName,
      sizeBytes: artifact.size,
      sha256: await sha256File(artifactPath),
    };
    const crypto = verificationCrypto();
    verifyRelease({
      manifest,
      signature,
      trustedKeys,
      crypto,
      artifact: observedArtifact,
    });
    const tamperedArtifactPath = join(workRoot, staged.archiveName);
    await copyFile(artifactPath, tamperedArtifactPath);
    const tamperedHandle = await open(tamperedArtifactPath, 'r+');
    try {
      const offset = Math.floor(artifact.size / 2);
      const byte = Buffer.alloc(1);
      await tamperedHandle.read(byte, 0, 1, offset);
      byte[0] = (byte[0] ?? 0) ^ 1;
      await tamperedHandle.write(byte, 0, 1, offset);
      await tamperedHandle.sync();
    } finally {
      await tamperedHandle.close();
    }
    const tamperedSha256 = await sha256File(tamperedArtifactPath);
    const artifactTamperRejected = requireReleaseFailure(
      () =>
        verifyRelease({
          manifest,
          signature,
          trustedKeys,
          crypto,
          artifact: {
            ...observedArtifact,
            sha256: tamperedSha256,
          },
        }),
      'release_artifact_hash_mismatch',
    );
    const modifiedManifest = {
      ...manifest,
      builtAt: new Date(
        new Date(manifest.builtAt).getTime() + 1_000,
      ).toISOString(),
    };
    const manifestTamperRejected = requireReleaseFailure(
      () =>
        verifyRelease({
          manifest: modifiedManifest,
          signature,
          trustedKeys,
          crypto,
          artifact: observedArtifact,
        }),
      'release_manifest_digest_mismatch',
    );
    const unknownKeyRejected = requireReleaseFailure(
      () =>
        verifyRelease({
          manifest: { ...manifest, signingKeyId: 'runner-release-unknown-31' },
          signature: { ...signature, keyId: 'runner-release-unknown-31' },
          trustedKeys,
          crypto,
          artifact: observedArtifact,
        }),
      'release_signing_key_unknown',
    );
    const preflightDecisions = {
      compatible: evaluateUpgradePreflight({
        currentVersion: manifest.version,
        targetRelease: manifest,
        currentLocalStateSchemaVersion: 1,
        currentLocalSecretVault: {
          schemaVersion: 1,
          protectionProfile: 'windows_dpapi_ng_machine_v1',
        },
        platform: 'windows',
        architecture: 'x64',
      }).decision,
      migrationRequired: evaluateUpgradePreflight({
        currentVersion: manifest.version,
        targetRelease: {
          ...manifest,
          compatibility: {
            ...manifest.compatibility,
            localState: { readableSchemas: [1, 2], writableSchema: 2 },
          },
        },
        currentLocalStateSchemaVersion: 1,
        currentLocalSecretVault: null,
        platform: 'windows',
        architecture: 'x64',
      }).decision,
      unsupported: evaluateUpgradePreflight({
        currentVersion: manifest.version,
        targetRelease: {
          ...manifest,
          compatibility: {
            ...manifest.compatibility,
            localState: { readableSchemas: [2], writableSchema: 2 },
          },
        },
        currentLocalStateSchemaVersion: 1,
        currentLocalSecretVault: null,
        platform: 'windows',
        architecture: 'x64',
      }).decision,
      downgradeBlocked: evaluateUpgradePreflight({
        currentVersion: '0.2.0',
        targetRelease: manifest,
        currentLocalStateSchemaVersion: 2,
        currentLocalSecretVault: null,
        platform: 'windows',
        architecture: 'x64',
      }).decision,
    };
    if (
      JSON.stringify(preflightDecisions) !==
      JSON.stringify({
        compatible: 'compatible',
        migrationRequired: 'migration_required',
        unsupported: 'unsupported',
        downgradeBlocked: 'downgrade_blocked',
      })
    ) {
      throw new Error('The release preflight verification matrix failed.');
    }
    const versionOutput = await invoke(
      join(staged.stagingRoot, 'runtime', 'node.exe'),
      [join(staged.stagingRoot, 'dist', 'index.js'), 'version'],
      { cwd: staged.stagingRoot, env: process.env },
    );
    if (
      !versionOutput.includes(
        `${staged.identity.product} ${staged.identity.version}`,
      )
    ) {
      throw new Error('The packaged Runner software identity is invalid.');
    }
    const publishedFiles = (await readdir(outputDirectory)).sort();
    const expectedFiles = [
      staged.archiveName,
      manifestPath.split(sep).at(-1),
      signaturePath.split(sep).at(-1),
    ].sort();
    if (JSON.stringify(publishedFiles) !== JSON.stringify(expectedFiles)) {
      throw new Error('The dry-run release file set is invalid.');
    }
    return {
      version: staged.identity.version,
      files: publishedFiles,
      artifactSha256: await sha256File(artifactPath),
      manifestSha256: signature.manifestSha256,
      signingMode: 'ephemeral_test_key',
      verification: {
        validReleaseAccepted: true,
        artifactTamperRejected,
        manifestTamperRejected,
        unknownKeyRejected,
      },
      preflightDecisions,
    };
  } finally {
    const resolvedTemp = resolve(workRoot);
    const resolvedSystemTemp = `${resolve(tmpdir())}${sep}`;
    if (
      resolvedTemp.startsWith(resolvedSystemTemp) &&
      relative(resolve(tmpdir()), resolvedTemp).startsWith(
        'tasktwin-runner-release-31-',
      )
    ) {
      await rm(resolvedTemp, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseOptions(process.argv.slice(2), {
    '--output-dir': true,
    '--browser-source': true,
    '--built-at': false,
  });
  const result = await runReleaseDryRun({
    outputDirectory: options['--output-dir'],
    browserSource: options['--browser-source'],
    builtAt: options['--built-at'] ?? new Date().toISOString(),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
