import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock('./execution/fixture-command.js', () => ({
  executeFixtureCommand: fixture.execute,
}));

import { runCli } from './cli.js';

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
