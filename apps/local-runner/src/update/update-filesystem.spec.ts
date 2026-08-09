import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ReleaseManifestSchema,
  ReleaseSignatureSchema,
  canonicalizeReleaseManifest,
  type TrustedReleaseKey,
  type VerifiedRelease,
} from '@tasktwin/runner-release';
import { z } from 'zod';
import { afterEach, describe, expect, it } from 'vitest';

import {
  WindowsReleaseArchiveExtractor,
  windowsPowerShellExecutable,
} from './archive-extractor.js';
import { AtomicJsonStore } from './atomic-json-store.js';
import {
  installedReleaseDirectoryName,
  runnerInstallationPaths,
  updateStagingDirectory,
} from './installation-layout.js';
import { validateExtractedReleaseTree } from './release-tree-validator.js';
import { FileRunnerUpdateLock } from './update-lock.js';
import { FileInstalledReleaseStore } from './installed-release-store.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(path);
  return path;
}

describe('Runner update filesystem boundaries', () => {
  it('derives only controlled installation and release paths', () => {
    const runnerDeviceId = randomUUID();
    const paths = runnerInstallationPaths({
      programData: resolve('C:/ProgramData'),
      runnerDeviceId,
    });
    expect(paths.root).toContain(runnerDeviceId);
    expect(
      installedReleaseDirectoryName({
        version: '1.2.3',
        manifestSha256: 'a'.repeat(64),
      }),
    ).toBe(`1.2.3-${'a'.repeat(32)}`);
    expect(updateStagingDirectory(paths, `ru1_${'b'.repeat(64)}`)).toContain(
      `ru1_${'b'.repeat(64)}`,
    );
    expect(() => updateStagingDirectory(paths, '../outside')).toThrow(
      'update ID',
    );
  });

  it('atomically validates and preserves the previous record on invalid writes', async () => {
    const directory = await temporaryDirectory('tasktwin-update-atomic-');
    const schema = z.strictObject({
      schemaVersion: z.literal(1),
      revision: z.number().int(),
    });
    const store = new AtomicJsonStore(join(directory, 'record.json'), schema);
    await store.replace({ schemaVersion: 1, revision: 1 });
    await expect(
      store.replace({ schemaVersion: 1, revision: 1.5 }),
    ).rejects.toThrow();
    await expect(store.read()).resolves.toEqual({
      schemaVersion: 1,
      revision: 1,
    });
    expect(
      JSON.parse(await readFile(join(directory, 'record.json'), 'utf8')),
    ).toEqual({
      schemaVersion: 1,
      revision: 1,
    });
  });

  it('prevents concurrent update leases and permits reuse after release', async () => {
    const directory = await temporaryDirectory('tasktwin-update-lock-');
    const lock = new FileRunnerUpdateLock(join(directory, 'update'));
    const first = await lock.acquire();
    await expect(lock.acquire()).rejects.toThrow('already in progress');
    await first.release();
    const next = await lock.acquire();
    await next.release();
  });

  it('recovers only a genuinely stale filesystem update owner', async () => {
    const directory = await temporaryDirectory('tasktwin-update-stale-lock-');
    const lockPath = join(directory, 'update');
    await mkdir(lockPath, { recursive: true });
    const properLockPath = `${lockPath}.lock`;
    await mkdir(properLockPath);
    const staleTime = new Date(Date.now() - 10_000);
    await utimes(properLockPath, staleTime, staleTime);
    const lock = new FileRunnerUpdateLock(lockPath, {
      staleMilliseconds: 2_000,
      updateMilliseconds: 1_000,
      retries: 0,
      retryMilliseconds: 10,
    });
    const recovered = await lock.acquire();
    await recovered.release();
  });
});

describe.runIf(process.platform === 'win32')(
  'Windows release archive extraction boundary',
  () => {
    const scriptPath = fileURLToPath(
      new URL('./windows-release-archive.ps1', import.meta.url),
    );

    it('resolves the archive adapter only from the absolute System32 path', () => {
      expect(windowsPowerShellExecutable('C:\\Windows')).toBe(
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      );
      expect(() => windowsPowerShellExecutable('.\\Windows')).toThrow(
        'system root',
      );
    });

    it('rejects an update-lock ancestor junction instead of splitting the lease', async () => {
      const directory = await temporaryDirectory(
        'tasktwin-update-lock-junction-',
      );
      const installation = join(directory, 'installation');
      const redirected = join(directory, 'redirected-locks');
      await mkdir(installation);
      await mkdir(redirected);
      const locks = join(installation, 'locks');
      await symlink(redirected, locks, 'junction');

      await expect(
        new FileRunnerUpdateLock(join(locks, 'update')).acquire(),
      ).rejects.toThrow(/link|reparse/i);
      await expect(stat(join(redirected, 'update'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });

    it('extracts and byte-compares a canonical archive', async () => {
      const directory = await temporaryDirectory('tasktwin-update-archive-');
      const artifact = join(directory, 'tasktwin-runner-1.2.3-windows-x64.zip');
      await writeStoredZip(artifact, [
        {
          name: 'tasktwin-runner-1.2.3-windows-x64/package.json',
          data: Buffer.from('{}'),
        },
      ]);
      const destination = join(directory, 'staging');
      const extractor = new WindowsReleaseArchiveExtractor(scriptPath);
      await expect(
        extractor.extract(artifact, destination),
      ).resolves.toMatchObject({
        ok: true,
        fileCount: 1,
      });
      await expect(
        extractor.compare(artifact, destination),
      ).resolves.toMatchObject({
        ok: true,
      });
      await writeFile(
        join(destination, 'tasktwin-runner-1.2.3-windows-x64/package.json'),
        'tampered',
      );
      await expect(extractor.compare(artifact, destination)).rejects.toThrow();
    });

    it.each([
      'tasktwin-runner-1.2.3-windows-x64/../escape.txt',
      '/tasktwin-runner-1.2.3-windows-x64/absolute.txt',
      'tasktwin-runner-1.2.3-windows-x64/C:/drive.txt',
      'tasktwin-runner-1.2.3-windows-x64/\\\\server\\share.txt',
      'tasktwin-runner-1.2.3-windows-x64/file.txt:stream',
    ])('rejects unsafe archive path %s', async (entryName) => {
      const directory = await temporaryDirectory('tasktwin-update-unsafe-');
      const artifact = join(directory, 'tasktwin-runner-1.2.3-windows-x64.zip');
      await writeStoredZip(artifact, [
        { name: entryName, data: Buffer.from('x') },
      ]);
      await expect(
        new WindowsReleaseArchiveExtractor(scriptPath).extract(
          artifact,
          join(directory, 'staging'),
        ),
      ).rejects.toThrow();
    });

    it('rejects excessive declared entry size before extraction', async () => {
      const directory = await temporaryDirectory('tasktwin-update-bomb-');
      const artifact = join(directory, 'tasktwin-runner-1.2.3-windows-x64.zip');
      await writeStoredZip(artifact, [
        {
          name: 'tasktwin-runner-1.2.3-windows-x64/bomb.bin',
          data: Buffer.alloc(0),
          declaredSize: 1024 * 1024 * 1024 + 1,
        },
      ]);
      const destination = join(directory, 'staging');
      await expect(
        new WindowsReleaseArchiveExtractor(scriptPath).extract(
          artifact,
          destination,
        ),
      ).rejects.toThrow();
      await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('rejects excessive entry count and Unix symlink metadata', async () => {
      const directory = await temporaryDirectory(
        'tasktwin-update-entry-limits-',
      );
      const crowdedArtifact = join(
        directory,
        'tasktwin-runner-1.2.3-windows-x64.zip',
      );
      await writeStoredZip(
        crowdedArtifact,
        Array.from({ length: 10_001 }, (_, index) => ({
          name: `tasktwin-runner-1.2.3-windows-x64/files/${index}.txt`,
          data: Buffer.alloc(0),
        })),
      );
      await expect(
        new WindowsReleaseArchiveExtractor(scriptPath).extract(
          crowdedArtifact,
          join(directory, 'crowded'),
        ),
      ).rejects.toThrow();

      const symlinkArtifact = join(
        directory,
        'tasktwin-runner-1.2.4-windows-x64.zip',
      );
      await writeStoredZip(symlinkArtifact, [
        {
          name: 'tasktwin-runner-1.2.4-windows-x64/link',
          data: Buffer.from('target'),
          unixMode: 0xa000,
        },
      ]);
      await expect(
        new WindowsReleaseArchiveExtractor(scriptPath).extract(
          symlinkArtifact,
          join(directory, 'symlink'),
        ),
      ).rejects.toThrow();
    });

    it('retains signed proof, commits outside staging, and detects payload tampering', async () => {
      const directory = await temporaryDirectory('tasktwin-update-install-');
      const fixture = await signedArchiveFixture(directory);
      const paths = runnerInstallationPaths({
        programData: directory,
        runnerDeviceId: randomUUID(),
      });
      const store = new FileInstalledReleaseStore(
        paths,
        new WindowsReleaseArchiveExtractor(scriptPath),
        [fixture.trustedKey],
      );
      const installed = await store.stageAndCommit({
        updateId: `ru1_${'d'.repeat(64)}`,
        verifiedRelease: fixture.verified,
        manifestPath: fixture.manifestPath,
        signaturePath: fixture.signaturePath,
        artifactPath: fixture.artifactPath,
        installedAt: '2026-08-09T00:00:00.000Z',
      });
      expect(installed.paths.root.startsWith(paths.releases)).toBe(true);
      await expect(stat(installed.paths.manifest)).resolves.toMatchObject({
        size: expect.any(Number),
      });
      await expect(
        store.findVerified(installed.record.releaseId),
      ).resolves.toMatchObject({ record: installed.record });

      const payloadFile = join(
        installed.paths.payload,
        'tasktwin-runner-1.2.3-windows-x64',
        'dist',
        'index.js',
      );
      await writeFile(payloadFile, 'tampered');
      await expect(
        store.findVerified(installed.record.releaseId),
      ).rejects.toThrow();
    });

    it('rejects a pre-existing staging junction before copying signed proof files', async () => {
      const directory = await temporaryDirectory('tasktwin-update-junction-');
      const fixture = await signedArchiveFixture(directory);
      const paths = runnerInstallationPaths({
        programData: directory,
        runnerDeviceId: randomUUID(),
      });
      const redirected = join(directory, 'redirected-staging');
      await mkdir(dirname(paths.staging), { recursive: true });
      await mkdir(redirected);
      await symlink(redirected, paths.staging, 'junction');
      const store = new FileInstalledReleaseStore(
        paths,
        new WindowsReleaseArchiveExtractor(scriptPath),
        [fixture.trustedKey],
      );

      await expect(
        store.stageAndCommit({
          updateId: `ru1_${'f'.repeat(64)}`,
          verifiedRelease: fixture.verified,
          manifestPath: fixture.manifestPath,
          signaturePath: fixture.signaturePath,
          artifactPath: fixture.artifactPath,
          installedAt: '2026-08-09T00:00:00.000Z',
        }),
      ).rejects.toThrow(/link|reparse/i);
      await expect(
        stat(join(redirected, `ru1_${'f'.repeat(64)}`)),
      ).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });
  },
);

describe('extracted release tree validation', () => {
  it('accepts the exact runtime allowlist and rejects unexpected roots', async () => {
    const directory = await temporaryDirectory('tasktwin-update-tree-');
    const verified = verifiedReleaseFixture();
    const root = join(directory, 'tasktwin-runner-1.2.3-windows-x64');
    for (const path of [
      'dist/release',
      'dist/platform/windows',
      'dist/update',
      'runtime',
      'windows/vendor/winsw-2.12.0',
      'browsers/chromium-123',
      'browsers/chromium_headless_shell-123',
      'node_modules',
    ]) {
      await mkdir(join(root, path), { recursive: true });
    }
    const identity = {
      product: 'tasktwin-runner',
      version: '1.2.3',
      sourceCommit: 'a'.repeat(40),
      platform: 'windows',
      architecture: 'x64',
      runnerProtocolVersion: 2,
      workflowSchemaVersion: 1,
      localStateSchemaVersion: 1,
      localSecretVaultSchemaVersion: 1,
    };
    const files: Record<string, string> = {
      'package.json': JSON.stringify({
        name: '@tasktwin/local-runner',
        version: '1.2.3',
        private: true,
        type: 'module',
        main: './dist/index.js',
      }),
      'runner.cmd': '@echo off',
      'dist/index.js': 'export {};',
      'dist/release/build-identity.json': JSON.stringify(identity),
      'dist/platform/windows/windows-native-bridge.ps1': '# bridge',
      'dist/platform/windows/windows-runner-installation-acl.ps1': '# acl',
      'dist/update/windows-release-archive.ps1': '# archive',
      'runtime/node.exe': 'node',
      'runtime/LICENSE': 'license',
      'windows/THIRD_PARTY_NOTICES.md': 'notices',
      'windows/vendor/winsw-2.12.0/WinSW.NET461.exe': 'winsw',
      'browsers/chromium-123/chrome.exe': 'chromium',
      'browsers/chromium_headless_shell-123/headless_shell.exe': 'headless',
    };
    await Promise.all(
      Object.entries(files).map(async ([name, contents]) => {
        await mkdir(join(root, name, '..'), { recursive: true });
        await writeFile(join(root, name), contents);
      }),
    );
    await expect(
      validateExtractedReleaseTree({
        extractionDirectory: directory,
        verifiedRelease: verified,
      }),
    ).resolves.toMatchObject({ fileCount: Object.keys(files).length });

    await writeFile(join(root, '.env'), 'UPDATE_SECRET_LEAK_32');
    await expect(
      validateExtractedReleaseTree({
        extractionDirectory: directory,
        verifiedRelease: verified,
      }),
    ).rejects.toThrow(/prohibited|allowlisted/);
  });
});

function verifiedReleaseFixture(): VerifiedRelease {
  const manifest = ReleaseManifestSchema.parse({
    schemaVersion: 1,
    product: 'tasktwin-runner',
    version: '1.2.3',
    channel: 'stable',
    sourceCommit: 'a'.repeat(40),
    builtAt: '2026-08-09T00:00:00.000Z',
    compatibility: {
      runnerProtocolVersion: 2,
      workflowSchema: { readable: { min: 1, max: 1 } },
      localState: { readableSchemas: [1], writableSchema: 1 },
      localSecretVault: {
        readableSchemas: [1],
        writableSchema: 1,
        readableProtectionProfiles: [
          'local_secret_master_key_wrap_v1',
          'windows_dpapi_ng_machine_v1',
        ],
      },
    },
    artifacts: [
      {
        platform: 'windows',
        architecture: 'x64',
        fileName: 'tasktwin-runner-1.2.3-windows-x64.zip',
        archiveFormat: 'zip',
        sizeBytes: 1,
        sha256: 'b'.repeat(64),
      },
    ],
    signingKeyId: 'test-key',
  });
  return {
    manifest,
    signature: ReleaseSignatureSchema.parse({
      schemaVersion: 1,
      algorithm: 'Ed25519',
      keyId: 'test-key',
      manifestSha256: 'c'.repeat(64),
      signature: Buffer.alloc(64).toString('base64url'),
    }),
    artifact: manifest.artifacts[0]!,
    canonicalManifest: '{}',
    manifestSha256: 'c'.repeat(64),
  };
}

interface StoredZipEntry {
  readonly name: string;
  readonly data: Buffer;
  readonly declaredSize?: number;
  readonly unixMode?: number;
}

async function writeStoredZip(
  path: string,
  entries: readonly StoredZipEntry[],
): Promise<void> {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const declaredSize = entry.declaredSize ?? entry.data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(declaredSize, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(entry.unixMode === undefined ? 20 : 0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(declaredSize, 24);
    central.writeUInt16LE(name.length, 28);
    if (entry.unixMode !== undefined) {
      central.writeUInt32LE((entry.unixMode << 16) >>> 0, 38);
    }
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + entry.data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  await writeFile(path, Buffer.concat([...localParts, centralDirectory, end]));
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const value of data) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function signedArchiveFixture(directory: string): Promise<{
  artifactPath: string;
  manifestPath: string;
  signaturePath: string;
  trustedKey: TrustedReleaseKey;
  verified: VerifiedRelease;
}> {
  const artifactPath = join(directory, 'tasktwin-runner-1.2.3-windows-x64.zip');
  const root = 'tasktwin-runner-1.2.3-windows-x64';
  const identity = {
    product: 'tasktwin-runner',
    version: '1.2.3',
    sourceCommit: 'a'.repeat(40),
    platform: 'windows',
    architecture: 'x64',
    runnerProtocolVersion: 2,
    workflowSchemaVersion: 1,
    localStateSchemaVersion: 1,
    localSecretVaultSchemaVersion: 1,
  };
  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      name: '@tasktwin/local-runner',
      version: '1.2.3',
      private: true,
      type: 'module',
      main: './dist/index.js',
    }),
    'runner.cmd': '@echo off',
    'dist/index.js': 'export {};',
    'dist/release/build-identity.json': JSON.stringify(identity),
    'dist/platform/windows/windows-native-bridge.ps1': '# bridge',
    'dist/platform/windows/windows-runner-installation-acl.ps1': '# acl',
    'dist/update/windows-release-archive.ps1': '# updater',
    'runtime/node.exe': 'node',
    'runtime/LICENSE': 'license',
    'windows/THIRD_PARTY_NOTICES.md': 'notices',
    'windows/vendor/winsw-2.12.0/WinSW.NET461.exe': 'winsw',
    'browsers/chromium-123/chrome.exe': 'chromium',
    'browsers/chromium_headless_shell-123/headless_shell.exe': 'headless',
  };
  await writeStoredZip(
    artifactPath,
    Object.entries(files).map(([name, contents]) => ({
      name: `${root}/${name}`,
      data: Buffer.from(contents),
    })),
  );
  const artifact = await readFile(artifactPath);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const manifest = ReleaseManifestSchema.parse({
    schemaVersion: 1,
    product: 'tasktwin-runner',
    version: '1.2.3',
    channel: 'stable',
    sourceCommit: 'a'.repeat(40),
    builtAt: '2026-08-09T00:00:00.000Z',
    compatibility: {
      runnerProtocolVersion: 2,
      workflowSchema: { readable: { min: 1, max: 1 } },
      localState: { readableSchemas: [1], writableSchema: 1 },
      localSecretVault: {
        readableSchemas: [1],
        writableSchema: 1,
        readableProtectionProfiles: [
          'local_secret_master_key_wrap_v1',
          'windows_dpapi_ng_machine_v1',
        ],
      },
    },
    artifacts: [
      {
        platform: 'windows',
        architecture: 'x64',
        fileName: 'tasktwin-runner-1.2.3-windows-x64.zip',
        archiveFormat: 'zip',
        sizeBytes: artifact.byteLength,
        sha256: createHash('sha256').update(artifact).digest('hex'),
      },
    ],
    signingKeyId: 'runner-update-test-32',
  });
  const canonicalManifest = canonicalizeReleaseManifest(manifest);
  const manifestSha256 = createHash('sha256')
    .update(canonicalManifest)
    .digest('hex');
  const signature = ReleaseSignatureSchema.parse({
    schemaVersion: 1,
    algorithm: 'Ed25519',
    keyId: manifest.signingKeyId,
    manifestSha256,
    signature: sign(null, Buffer.from(canonicalManifest), privateKey).toString(
      'base64url',
    ),
  });
  const trustedKey: TrustedReleaseKey = {
    keyId: manifest.signingKeyId,
    algorithm: 'Ed25519',
    publicKeySpkiDerBase64Url: publicKey
      .export({ format: 'der', type: 'spki' })
      .toString('base64url'),
  };
  const manifestPath = join(directory, 'release-manifest.json');
  const signaturePath = join(directory, 'release-signature.json');
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(signaturePath, JSON.stringify(signature));
  return {
    artifactPath,
    manifestPath,
    signaturePath,
    trustedKey,
    verified: {
      manifest,
      signature,
      artifact: manifest.artifacts[0]!,
      canonicalManifest,
      manifestSha256,
    },
  };
}
