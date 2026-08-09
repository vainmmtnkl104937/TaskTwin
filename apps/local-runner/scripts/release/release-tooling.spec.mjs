import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { inspectReleaseStaging } from './inspect-release-staging.mjs';
import { validateRunnerTagVersion } from './validate-tag-version.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function stagingFixture(version = '1.4.0') {
  const parent = await mkdtemp(join(tmpdir(), 'tasktwin-release-stage-test-'));
  temporaryDirectories.push(parent);
  const root = join(parent, `tasktwin-runner-${version}-windows-x64`);
  for (const directory of [
    'dist/release',
    'runtime',
    'windows/vendor/winsw-2.12.0',
    'browsers/chromium-1234',
  ]) {
    await mkdir(join(root, directory), { recursive: true });
  }
  await Promise.all([
    writeFile(join(root, 'runner.cmd'), '@echo off\r\n'),
    writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        name: '@tasktwin/local-runner',
        version,
        private: true,
        type: 'module',
        main: './dist/index.js',
      }),
    ),
    writeFile(join(root, 'dist/index.js'), 'export {};\n'),
    writeFile(join(root, 'dist/release/build-identity.json'), '{}\n'),
    writeFile(join(root, 'runtime/node.exe'), 'test node'),
    writeFile(join(root, 'runtime/LICENSE'), 'test license'),
    writeFile(
      join(root, 'windows/vendor/winsw-2.12.0/WinSW.NET461.exe'),
      'test wrapper',
    ),
    writeFile(join(root, 'browsers/chromium-1234/chrome.exe'), 'test browser'),
  ]);
  return root;
}

describe('Windows x64 release safety tooling', () => {
  it('accepts only the controlled staging roots and required runtime files', async () => {
    await expect(
      inspectReleaseStaging(await stagingFixture()),
    ).resolves.toEqual({
      fileCount: 8,
    });
  });

  it('accepts canonical stable SemVer build metadata in the staged name', async () => {
    await expect(
      inspectReleaseStaging(await stagingFixture('1.4.0+build.7')),
    ).resolves.toEqual({ fileCount: 8 });
  });

  it.each([
    ['.env', 'LOCAL_SECRET_STORE_LEAK_31'],
    ['.tasktwin/local-secret-vault.v1.json', '{}'],
    ['dist/credential.js', 'RUNNER_CREDENTIAL_LEAK_31'],
    ['dist/signing.js', 'RELEASE_PRIVATE_KEY_LEAK_31'],
  ])(
    'rejects prohibited path/content fixture %s',
    async (relativePath, marker) => {
      const root = await stagingFixture();
      const path = join(root, ...relativePath.split('/'));
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, marker);
      await expect(inspectReleaseStaging(root)).rejects.toThrow(
        /prohibited|allowlisted/,
      );
    },
  );

  it('rejects Local Secret Vault and Runner credential file names', async () => {
    const root = await stagingFixture();
    await writeFile(join(root, 'local-secret-vault.v1.json'), '{}');
    await expect(inspectReleaseStaging(root)).rejects.toThrow('prohibited');
  });
});

describe('Runner release tag validation', () => {
  async function identityFile() {
    const directory = await mkdtemp(
      join(tmpdir(), 'tasktwin-release-tag-test-'),
    );
    temporaryDirectories.push(directory);
    const path = join(directory, 'build-identity.json');
    await writeFile(
      path,
      JSON.stringify({
        product: 'tasktwin-runner',
        version: '1.4.0',
        sourceCommit: 'a'.repeat(40),
        platform: 'windows',
        architecture: 'x64',
        runnerProtocolVersion: 2,
        workflowSchemaVersion: 1,
        localStateSchemaVersion: 1,
        localSecretVaultSchemaVersion: 1,
      }),
    );
    return path;
  }

  it('requires exact tag/package/embedded version equality', async () => {
    const path = await identityFile();
    await expect(
      validateRunnerTagVersion({
        tag: 'runner-v1.4.0',
        packageVersion: '1.4.0',
        buildIdentityPath: path,
      }),
    ).resolves.toBe('1.4.0');
  });

  it('fails instead of rewriting a mismatched version', async () => {
    const path = await identityFile();
    await expect(
      validateRunnerTagVersion({
        tag: 'runner-v1.4.1',
        packageVersion: '1.4.0',
        buildIdentityPath: path,
      }),
    ).rejects.toThrow('do not match');
  });
});
