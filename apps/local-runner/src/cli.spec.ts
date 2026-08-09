import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock('./execution/fixture-command.js', () => ({
  executeFixtureCommand: fixture.execute,
}));

import {
  determineRuntimeMode,
  parseServiceCommandArguments,
  runCli,
} from './cli.js';
import type { RunnerUpdateController } from './update/update-controller.js';

describe('Local Runner execution CLI cancellation', () => {
  beforeEach(() => {
    fixture.execute.mockReset();
  });

  it('converts SIGINT to cancellation and waits for command cleanup', async () => {
    let cleanupComplete = false;
    fixture.execute.mockImplementation(
      async (
        _output: unknown,
        _headed: boolean,
        signal: AbortSignal,
      ): Promise<number> =>
        new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              void Promise.resolve().then(() => {
                cleanupComplete = true;
                resolve(2);
              });
            },
            { once: true },
          );
        }),
    );

    const command = runCli(['execute-fixture']);
    await vi.waitFor(() => expect(fixture.execute).toHaveBeenCalledOnce());
    process.emit('SIGINT');
    await expect(command).resolves.toBe(2);
    expect(cleanupComplete).toBe(true);
  });
});

describe('Local Runner runtime mode parsing', () => {
  it('keeps a custom service data root local to service installation', () => {
    expect(
      parseServiceCommandArguments([
        'install',
        '--data-root',
        'D:\\TaskTwinData',
      ]),
    ).toEqual({
      operations: ['install'],
      dataRoot: 'D:\\TaskTwinData',
    });
  });

  it('prints the embedded Runner identity', async () => {
    const messages: string[] = [];
    await expect(
      runCli(
        ['version'],
        { write: (message) => messages.push(message) },
        {
          readBuildIdentity: async () => ({
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
        },
      ),
    ).resolves.toBe(0);
    expect(messages.join('\n')).toContain('tasktwin-runner 1.4.0');
    expect(messages.join('\n')).toContain('source commit:');
  });

  it('routes update status before constructing secret or browser runtime state', async () => {
    const messages: string[] = [];
    const status = vi.fn(async () => ({ activeRelease: null, update: null }));
    const controller = { status } as unknown as RunnerUpdateController;
    await expect(
      runCli(
        ['update', 'status', '--data-root', 'D:\\TaskTwinData'],
        { write: (message) => messages.push(message) },
        { createUpdateController: async () => controller },
      ),
    ).resolves.toBe(0);
    expect(status).toHaveBeenCalledOnce();
    expect(messages).toEqual([
      JSON.stringify({ activeRelease: null, update: null }),
    ]);
  });

  it('derives explicit modes and rejects interactive service components', () => {
    expect(
      determineRuntimeMode({
        command: 'start',
        requested: undefined,
        headed: true,
        attended: true,
      }),
    ).toBe('interactive');
    expect(
      determineRuntimeMode({
        command: 'start',
        requested: 'unattended_process',
        headed: false,
        attended: false,
      }),
    ).toBe('unattended_process');
    expect(
      determineRuntimeMode({
        command: 'service-run',
        requested: undefined,
        headed: false,
        attended: false,
      }),
    ).toBe('service');
    expect(() =>
      determineRuntimeMode({
        command: 'service-run',
        requested: undefined,
        headed: true,
        attended: true,
      }),
    ).toThrow('Service mode rejects interactive execution options.');
  });
});
