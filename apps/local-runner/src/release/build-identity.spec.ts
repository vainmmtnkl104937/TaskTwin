import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  formatRunnerVersion,
  readEmbeddedBuildIdentity,
  reportedSoftwareIdentity,
} from './build-identity.js';

const identity = {
  product: 'tasktwin-runner' as const,
  version: '1.4.0',
  sourceCommit: 'a'.repeat(40),
  platform: 'windows' as const,
  architecture: 'x64' as const,
  runnerProtocolVersion: 2,
  workflowSchemaVersion: 1,
  localStateSchemaVersion: 1,
  localSecretVaultSchemaVersion: 1,
};

describe('embedded Runner build identity', () => {
  it('reads immutable package metadata and reports only safe heartbeat fields', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tasktwin-build-identity-'));
    const path = join(directory, 'build-identity.json');
    await writeFile(path, JSON.stringify(identity), 'utf8');
    const parsed = await readEmbeddedBuildIdentity(pathToFileURL(path));
    expect(parsed).toEqual(identity);
    expect(reportedSoftwareIdentity(parsed)).toEqual({
      product: 'tasktwin-runner',
      version: '1.4.0',
      platform: 'windows',
      architecture: 'x64',
      runnerProtocolVersion: 2,
      workflowSchemaVersion: 1,
      localStateSchemaVersion: 1,
    });
    expect(JSON.stringify(reportedSoftwareIdentity(parsed))).not.toContain(
      identity.sourceCommit,
    );
    expect(formatRunnerVersion(parsed)).toContain('tasktwin-runner 1.4.0');
  });

  it('cannot be overridden by mutable local configuration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tasktwin-build-identity-'));
    const identityPath = join(directory, 'build-identity.json');
    const configPath = join(directory, 'runner-config.json');
    await writeFile(identityPath, JSON.stringify(identity), 'utf8');
    await writeFile(configPath, JSON.stringify({ version: '99.0.0' }), 'utf8');
    const before = await readFile(configPath, 'utf8');
    expect(
      (await readEmbeddedBuildIdentity(pathToFileURL(identityPath))).version,
    ).toBe('1.4.0');
    expect(await readFile(configPath, 'utf8')).toBe(before);
  });

  it('rejects unexpected build metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tasktwin-build-identity-'));
    const path = join(directory, 'build-identity.json');
    await writeFile(
      path,
      JSON.stringify({ ...identity, localPath: 'C:\\state' }),
    );
    await expect(
      readEmbeddedBuildIdentity(pathToFileURL(path)),
    ).rejects.toThrow('build identity is invalid');
  });
});
