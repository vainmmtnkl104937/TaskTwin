import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  WindowsRunnerServiceActivationConfigSchema,
  WindowsRunnerServiceConfigSchema,
  WindowsRunnerServiceManager,
  buildWindowsServiceXml,
  parseWindowsServiceBinaryPath,
  readWindowsRunnerServiceConfig,
  type WindowsServiceCommandRunner,
} from './windows-service-manager.js';
import { runnerWindowsServiceName } from './windows-service-identity.js';

const RUNNER_ID = '753ff8fc-4267-4d99-b741-41485f5bab45';
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
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

  it('requires adjacent same-basename WinSW activation files', () => {
    const activation = {
      schemaVersion: 1 as const,
      activationId: `ru1_${'a'.repeat(64)}`,
      releaseVersion: '1.4.0',
      manifestSha256: 'b'.repeat(64),
      serviceName: runnerWindowsServiceName(RUNNER_ID),
      runnerDeviceId: RUNNER_ID,
      dataRoot: 'C:\\TaskTwin Data',
      nodeExecutable: 'C:\\TaskTwin\\1.4.0\\runtime\\node.exe',
      runnerEntryPoint: 'C:\\TaskTwin\\1.4.0\\dist\\index.js',
      serviceConfigPath:
        'C:\\TaskTwin\\1.4.0\\activation\\runner-service.v1.json',
      serviceExecutablePath: `C:\\TaskTwin\\1.4.0\\activation\\${runnerWindowsServiceName(RUNNER_ID)}.exe`,
      serviceXmlPath: `C:\\TaskTwin\\1.4.0\\activation\\${runnerWindowsServiceName(RUNNER_ID)}.xml`,
      startupStatusPath:
        'C:\\ProgramData\\TaskTwin\\runtime\\startup-status.v1.json',
      updateJournalPath: 'C:\\ProgramData\\TaskTwin\\update-journal.v1.json',
      logDirectory: 'C:\\ProgramData\\TaskTwin\\runtime\\logs',
      softwareIdentity: {
        product: 'tasktwin-runner' as const,
        version: '1.4.0',
        runnerProtocolVersion: 2,
        workflowSchemaVersion: 1,
        localStateSchemaVersion: 1,
        platform: 'windows' as const,
        architecture: 'x64' as const,
      },
      requireNativeSecretAutoUnlock: true,
    };
    expect(
      WindowsRunnerServiceActivationConfigSchema.parse(activation),
    ).toEqual(activation);
    expect(
      WindowsRunnerServiceActivationConfigSchema.safeParse({
        ...activation,
        serviceXmlPath: 'C:\\TaskTwin\\1.4.0\\activation\\different-name.xml',
      }).success,
    ).toBe(false);
    expect(
      WindowsRunnerServiceActivationConfigSchema.safeParse({
        ...activation,
        signingPrivateKey: 'forbidden',
      }).success,
    ).toBe(false);
  });

  it('parses only an exact executable SCM binary path', () => {
    expect(
      parseWindowsServiceBinaryPath(
        '"C:\\ProgramData\\TaskTwin\\TaskTwinRunner.exe"',
      ),
    ).toBe('C:\\ProgramData\\TaskTwin\\TaskTwinRunner.exe');
    expect(() =>
      parseWindowsServiceBinaryPath(
        '"C:\\ProgramData\\TaskTwin\\TaskTwinRunner.exe" --unexpected',
      ),
    ).toThrow();
  });

  it('waits for SCM state and compare-and-swaps the exact binary path', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'tasktwin-service-manager-'),
    );
    directories.push(directory);
    const target = join(directory, 'TaskTwinRunner_target.exe');
    await copyFile(
      resolve('windows', 'vendor', 'winsw-2.12.0', 'WinSW.NET461.exe'),
      target,
    );
    let state: 'running' | 'stopped' = 'running';
    let binaryPath = 'C:\\TaskTwin\\source\\TaskTwinRunner.exe';
    const commandRunner: WindowsServiceCommandRunner = {
      run: async (executable, args) => {
        expect(executable).toBe('C:\\Windows\\System32\\sc.exe');
        const command = args[0];
        if (command === 'query') {
          return {
            code: 0,
            output:
              state === 'running'
                ? 'STATE              : 4  RUNNING'
                : 'STATE              : 1  STOPPED',
          };
        }
        if (command === 'qc') {
          return {
            code: 0,
            output: `START_TYPE         : 2   AUTO_START\nBINARY_PATH_NAME   : "${binaryPath}"`,
          };
        }
        if (command === 'stop') state = 'stopped';
        if (command === 'start') state = 'running';
        if (command === 'config') binaryPath = target;
        return { code: 0, output: '' };
      },
    };
    const manager = new WindowsRunnerServiceManager(
      'C:\\TaskTwin\\source\\dist\\index.js',
      'C:\\TaskTwin Data',
      'C:\\ProgramData',
      {
        platform: 'win32',
        systemRoot: 'C:\\Windows',
        commandRunner,
        sleep: async () => undefined,
      },
    );
    await manager.stopAndWait(RUNNER_ID);
    expect(state).toBe('stopped');
    await manager.rebindBinaryPath({
      runnerDeviceId: RUNNER_ID,
      expectedSourcePath: binaryPath,
      targetPath: target,
    });
    expect(binaryPath).toBe(target);
    await manager.startAndWait(RUNNER_ID);
    expect(state).toBe('running');
    await manager.stopAndWait(RUNNER_ID);
    const tamperedTarget = join(directory, 'TaskTwinRunner_tampered.exe');
    await writeFile(tamperedTarget, 'not the checksum-pinned WinSW binary');
    await expect(
      manager.rebindBinaryPath({
        runnerDeviceId: RUNNER_ID,
        expectedSourcePath: target,
        targetPath: tamperedTarget,
      }),
    ).rejects.toMatchObject({
      code: 'RUNNER_SERVICE_CONFIGURATION_INVALID',
    });
    expect(binaryPath).toBe(target);
  });

  it('rejects retained activation XML or configuration tampering before rebind and start', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'tasktwin-activation-proof-'),
    );
    directories.push(directory);
    const activationDirectory = join(directory, 'activation');
    const nodeExecutable = join(directory, 'payload', 'runtime', 'node.exe');
    const runnerEntryPoint = join(directory, 'payload', 'dist', 'index.js');
    const identityPath = join(
      directory,
      'payload',
      'dist',
      'release',
      'build-identity.json',
    );
    await Promise.all([
      mkdir(join(directory, 'payload', 'runtime'), { recursive: true }),
      mkdir(join(directory, 'payload', 'dist', 'release'), {
        recursive: true,
      }),
    ]);
    await Promise.all([
      writeFile(nodeExecutable, 'verified node'),
      writeFile(runnerEntryPoint, 'verified runner'),
      writeFile(identityPath, 'verified identity'),
    ]);
    let state: 'running' | 'stopped' = 'stopped';
    let binaryPath = join(directory, 'source.exe');
    const manager = new WindowsRunnerServiceManager(
      resolve('dist', 'index.js'),
      join(directory, 'data'),
      directory,
      {
        platform: 'win32',
        systemRoot: 'C:\\Windows',
        commandRunner: {
          run: async (_executable, args) => {
            if (args[0] === 'query') {
              return {
                code: 0,
                output:
                  state === 'running'
                    ? 'STATE : 4 RUNNING'
                    : 'STATE : 1 STOPPED',
              };
            }
            if (args[0] === 'qc') {
              return {
                code: 0,
                output: `BINARY_PATH_NAME : "${binaryPath}"`,
              };
            }
            if (args[0] === 'config') {
              binaryPath = args[3]?.slice(1, -1) ?? binaryPath;
            }
            if (args[0] === 'start') state = 'running';
            return { code: 0, output: '' };
          },
        },
        sleep: async () => undefined,
      },
    );
    const activation = await manager.prepareActivation({
      activationId: `ru1_${'c'.repeat(64)}`,
      releaseVersion: '1.4.0',
      manifestSha256: 'd'.repeat(64),
      runnerDeviceId: RUNNER_ID,
      activationDirectory,
      dataRoot: join(directory, 'data'),
      nodeExecutable,
      runnerEntryPoint,
      startupStatusPath: join(directory, 'runtime', 'startup-status.v1.json'),
      updateJournalPath: join(directory, 'update-journal.v1.json'),
      logDirectory: join(directory, 'logs'),
      softwareIdentity: {
        product: 'tasktwin-runner',
        version: '1.4.0',
        runnerProtocolVersion: 2,
        workflowSchemaVersion: 1,
        localStateSchemaVersion: 1,
        platform: 'windows',
        architecture: 'x64',
      },
      requireNativeSecretAutoUnlock: true,
    });
    const activationConfigPath = join(
      activationDirectory,
      'runner-service-activation.v1.json',
    );
    const proof = await manager.attestActivation({
      activationConfigPath,
      expected: activation,
    });
    const retainedFiles = [
      activationConfigPath,
      activation.serviceConfigPath,
      activation.serviceXmlPath,
    ];
    for (const retainedFile of retainedFiles) {
      const original = await readFile(retainedFile);
      await writeFile(
        retainedFile,
        Buffer.concat([original, Buffer.from(' ')]),
      );
      await expect(
        manager.rebindBinaryPath({
          runnerDeviceId: RUNNER_ID,
          expectedSourcePath: binaryPath,
          targetPath: activation.serviceExecutablePath,
          activationProof: proof,
        }),
      ).rejects.toMatchObject({
        code: 'RUNNER_SERVICE_CONFIGURATION_INVALID',
      });
      expect(binaryPath).not.toBe(activation.serviceExecutablePath);
      await writeFile(retainedFile, original);
    }

    await manager.rebindBinaryPath({
      runnerDeviceId: RUNNER_ID,
      expectedSourcePath: binaryPath,
      targetPath: activation.serviceExecutablePath,
      activationProof: proof,
    });
    const originalXml = await readFile(activation.serviceXmlPath);
    await writeFile(
      activation.serviceXmlPath,
      '<service><executable>malicious.exe</executable></service>',
    );
    await expect(
      manager.startAndWait(RUNNER_ID, undefined, proof),
    ).rejects.toMatchObject({
      code: 'RUNNER_SERVICE_CONFIGURATION_INVALID',
    });
    expect(state).toBe('stopped');
    await writeFile(activation.serviceXmlPath, originalXml);
    await writeFile(nodeExecutable, 'tampered node executable');
    await expect(
      manager.startAndWait(RUNNER_ID, undefined, proof),
    ).rejects.toMatchObject({
      code: 'RUNNER_SERVICE_CONFIGURATION_INVALID',
    });
    expect(state).toBe('stopped');
  });

  it('installs from an adjacent same-basename WinSW activation without an XML argument', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'tasktwin-service-install-'),
    );
    directories.push(directory);
    const serviceName = runnerWindowsServiceName(RUNNER_ID);
    const expectedExecutable = join(
      directory,
      'TaskTwin',
      'RunnerServices',
      serviceName,
      'current',
      `${serviceName}.exe`,
    );
    const calls: Array<{
      executable: string;
      args: readonly string[];
    }> = [];
    let installedBinary: string | null = null;
    const manager = new WindowsRunnerServiceManager(
      resolve('dist', 'index.js'),
      join(directory, 'data'),
      directory,
      {
        platform: 'win32',
        systemRoot: 'C:\\Windows',
        commandRunner: {
          run: async (executable, args) => {
            calls.push({ executable, args });
            if (args[0] === 'install') installedBinary = executable;
            if (args[0] === 'qc') {
              return {
                code: 0,
                output: `BINARY_PATH_NAME : "${installedBinary ?? ''}"`,
              };
            }
            return { code: 0, output: '' };
          },
        },
      },
    );
    await manager.install(RUNNER_ID);
    expect(installedBinary).toBe(expectedExecutable);
    expect(calls.find(({ args }) => args[0] === 'install')?.args).toEqual([
      'install',
    ]);
    expect(calls.find(({ args }) => args[0] === 'sidtype')?.executable).toBe(
      'C:\\Windows\\System32\\sc.exe',
    );
    expect(calls.find(({ args }) => args.includes('/grant'))?.executable).toBe(
      'C:\\Windows\\System32\\icacls.exe',
    );
    const xmlPath = expectedExecutable.replace(/\.exe$/i, '.xml');
    expect((await lstat(expectedExecutable)).isFile()).toBe(true);
    expect((await lstat(xmlPath)).isFile()).toBe(true);
    expect(await readFile(xmlPath, 'utf8')).toContain(
      `<id>${serviceName}</id>`,
    );
  });

  it('rejects symlink-like or unexpected persisted configuration data', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tasktwin-service-config-'));
    directories.push(directory);
    const path = join(directory, 'runner-service.v1.json');
    await writeFile(
      path,
      JSON.stringify({ ...configuration(), hostname: 'forbidden' }),
    );
    await expect(readWindowsRunnerServiceConfig(path)).rejects.toMatchObject({
      code: 'RUNNER_SERVICE_CONFIGURATION_INVALID',
    });
  });
});
