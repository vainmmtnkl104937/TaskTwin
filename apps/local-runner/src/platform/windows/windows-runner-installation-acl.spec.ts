import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  WindowsRunnerInstallationAclBoundary,
  runnerInstallationRootFromActivationPath,
  windowsServiceSid,
  type WindowsAclCommandRunner,
} from './windows-runner-installation-acl.js';
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

describe('Windows Runner installation ACL boundary', () => {
  it('derives the stable Windows service SID without localized account names', () => {
    expect(windowsServiceSid(runnerWindowsServiceName(RUNNER_ID))).toBe(
      'S-1-5-80-208657498-2297299622-595370628-3965697156-1747009501',
    );
  });

  it('uses a fixed System32 executable and separate arguments', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tasktwin-acl-boundary-'));
    directories.push(directory);
    const root = join(directory, 'TaskTwin', 'RunnerInstallations', RUNNER_ID);
    const scriptPath = join(directory, 'adapter with spaces.ps1');
    await mkdir(root, { recursive: true });
    await writeFile(scriptPath, 'test adapter');
    const calls: Array<{ executable: string; args: readonly string[] }> = [];
    const commandRunner: WindowsAclCommandRunner = {
      run: async (executable, args) => {
        calls.push({ executable, args });
        return { code: 0, output: 'TASKTWIN_RUNNER_INSTALLATION_ACL_OK' };
      },
    };
    const boundary = new WindowsRunnerInstallationAclBoundary({
      root,
      runnerDeviceId: RUNNER_ID,
      scriptPath,
      systemRoot: 'C:\\Windows',
      platform: 'win32',
      commandRunner,
    });

    await boundary.protectAndValidate();
    await boundary.validate();

    expect(calls).toHaveLength(2);
    expect(calls[0]?.executable).toBe(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    );
    expect(calls[0]?.args).toContain(scriptPath);
    expect(calls[0]?.args).toContain(root);
    expect(calls[0]?.args).toContain(boundary.serviceSid);
    expect(calls[0]?.args).toContain('protect');
    expect(calls[1]?.args).toContain('validate');
    expect(calls[0]?.args).not.toContain(`"${root}"`);
  });

  it('fails closed when ACL application or validation does not self-verify', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tasktwin-acl-failure-'));
    directories.push(directory);
    const root = join(directory, 'TaskTwin', 'RunnerInstallations', RUNNER_ID);
    const scriptPath = join(directory, 'adapter.ps1');
    await mkdir(root, { recursive: true });
    await writeFile(scriptPath, 'test adapter');
    const boundary = new WindowsRunnerInstallationAclBoundary({
      root,
      runnerDeviceId: RUNNER_ID,
      scriptPath,
      systemRoot: 'C:\\Windows',
      platform: 'win32',
      commandRunner: {
        run: async () => ({ code: 1, output: '' }),
      },
    });

    await expect(boundary.protectAndValidate()).rejects.toThrow(
      'ACL boundary is invalid',
    );
    await expect(boundary.validate()).rejects.toThrow(
      'ACL boundary is invalid',
    );
  });

  it('derives only the expected per-device root from an activation path', () => {
    const activationPath = join(
      'C:\\ProgramData',
      'TaskTwin',
      'RunnerInstallations',
      RUNNER_ID,
      'releases',
      '1.4.0-digest',
      'activation',
      'runner-service-activation.v1.json',
    );
    expect(
      runnerInstallationRootFromActivationPath(activationPath, RUNNER_ID),
    ).toBe(
      join('C:\\ProgramData', 'TaskTwin', 'RunnerInstallations', RUNNER_ID),
    );
  });
});
