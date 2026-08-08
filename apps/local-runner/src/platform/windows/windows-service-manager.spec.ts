import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  WindowsRunnerServiceConfigSchema,
  buildWindowsServiceXml,
  readWindowsRunnerServiceConfig,
} from './windows-service-manager.js';
import { runnerWindowsServiceName } from './windows-service-identity.js';

const RUNNER_ID = '753ff8fc-4267-4d99-b741-41485f5bab45';
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function configuration() {
  return {
    schemaVersion: 1 as const,
    serviceName: runnerWindowsServiceName(RUNNER_ID),
    runnerDeviceId: RUNNER_ID,
    dataRoot: 'C:\\TaskTwin Data',
    nodeExecutable: 'C:\\Program Files\\nodejs\\node.exe',
    runnerEntryPoint: 'C:\\TaskTwin\\local-runner\\dist\\index.js',
  };
}

describe('Windows Runner service configuration', () => {
  it('binds the service name to one Runner and rejects unexpected local fields', () => {
    expect(WindowsRunnerServiceConfigSchema.parse(configuration())).toEqual(
      configuration(),
    );
    expect(
      WindowsRunnerServiceConfigSchema.safeParse({
        ...configuration(),
        serviceName: runnerWindowsServiceName(
          'ad8ca9d9-648e-47c5-8443-408a1308315d',
        ),
      }).success,
    ).toBe(false);
    expect(
      WindowsRunnerServiceConfigSchema.safeParse({
        ...configuration(),
        credential: 'forbidden',
      }).success,
    ).toBe(false);
  });

  it('creates fixed WinSW XML without credentials, secrets, or shell fragments', () => {
    const xml = buildWindowsServiceXml(
      WindowsRunnerServiceConfigSchema.parse(configuration()),
      'C:\\ProgramData\\TaskTwin\\runner-service.v1.json',
    );
    expect(xml).toContain('<startmode>Automatic</startmode>');
    expect(xml).toContain('NT AUTHORITY\\LocalService');
    expect(xml).toContain('service-run');
    expect(xml).toContain('--service-config');
    expect(xml).not.toContain('credential');
    expect(xml).not.toContain('passphrase');
    expect(xml).not.toContain('secretValue');
    expect(xml).not.toContain('&amp;&amp;');
  });

  it('rejects symlink-like or unexpected persisted configuration data', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tasktwin-service-config-'));
    directories.push(directory);
    const path = join(directory, 'runner-service.v1.json');
    await writeFile(path, JSON.stringify({ ...configuration(), hostname: 'forbidden' }));
    await expect(readWindowsRunnerServiceConfig(path)).rejects.toMatchObject({
      code: 'RUNNER_SERVICE_CONFIGURATION_INVALID',
    });
  });
});
