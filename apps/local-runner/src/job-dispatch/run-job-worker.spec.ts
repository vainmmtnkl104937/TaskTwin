import type { StoredRunnerCredential } from '@tasktwin/runner-protocol';
import { describe, expect, it, vi } from 'vitest';

import type { RunnerJobTransport } from '../control-plane-client.js';
import type { BrowserSessionFactory } from '../execution/browser-session.js';
import type { RunnerClock } from '../runner-service.js';
import { RunJobWorker } from './run-job-worker.js';

const credential: StoredRunnerCredential = {
  schemaVersion: 1,
  controlPlaneOrigin: 'https://api.tasktwin.example',
  runnerDeviceId: '753ff8fc-4267-4d99-b741-41485f5bab45',
  workspaceId: 'ad8ca9d9-648e-47c5-8443-408a1308315d',
  installationId: '8bff4d89-91ba-4efd-8927-a4b6e8abec9c',
  credential: 'A'.repeat(43),
  savedAt: '2026-08-10T00:00:00.000Z',
};

function abortableClock(): RunnerClock {
  return {
    now: () => new Date('2026-08-10T00:00:00.000Z'),
    sleep: (_milliseconds, signal) =>
      new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error('aborted'));
          return;
        }
        signal?.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        });
        if (signal === undefined) resolve();
      }),
  };
}

describe('RunJobWorker service lifecycle', () => {
  it('stops polling and makes no new claim after drain begins', async () => {
    const claimJob = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      status: 'no_job',
      pollAfterSeconds: 30,
    });
    const worker = new RunJobWorker(
      { claimJob } as unknown as RunnerJobTransport,
      {} as BrowserSessionFactory,
      abortableClock(),
      { write: vi.fn() },
      '0.1.0',
    );
    const running = worker.runLoop(credential, new AbortController().signal);
    await vi.waitFor(() => expect(claimJob).toHaveBeenCalledOnce());
    worker.beginDrain();
    await expect(running).resolves.toBeUndefined();
    expect(claimJob).toHaveBeenCalledOnce();
  });

  it('creates a fresh non-durable claim attempt after process restart', async () => {
    const claimAttemptIds: string[] = [];
    const runOnce = async () => {
      const worker = new RunJobWorker(
        {
          claimJob: vi.fn(async (_credential, request) => {
            claimAttemptIds.push(request.claimAttemptId);
            return {
              schemaVersion: 1,
              status: 'no_job',
              pollAfterSeconds: 30,
            };
          }),
        } as unknown as RunnerJobTransport,
        {} as BrowserSessionFactory,
        abortableClock(),
        { write: vi.fn() },
        '0.1.0',
      );
      const running = worker.runLoop(credential, new AbortController().signal);
      await vi.waitFor(() => expect(claimAttemptIds.length).toBeGreaterThan(0));
      worker.beginDrain();
      await running;
    };
    await runOnce();
    await runOnce();
    expect(claimAttemptIds).toHaveLength(2);
    expect(claimAttemptIds[0]).not.toBe(claimAttemptIds[1]);
  });
});
