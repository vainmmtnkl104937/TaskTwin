import type { StoredRunnerCredential } from '@tasktwin/runner-protocol';
import { describe, expect, it, vi } from 'vitest';

import type { RunnerJobTransport } from '../control-plane-client.js';
import type { BrowserSessionFactory } from '../execution/browser-session.js';
import type { RunnerClock } from '../runner-service.js';
import {
  RunJobWorker,
  assertClaimedJobCompatibility,
} from './run-job-worker.js';

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
  it('rejects unsupported protocol and Workflow schemas before execution', () => {
    expect(() =>
      assertClaimedJobCompatibility({
        runProtocolVersion: 999,
        workflowSchemaVersion: 1,
      }),
    ).toThrow('Runner protocol version is unsupported');
    expect(() =>
      assertClaimedJobCompatibility({
        runProtocolVersion: 2,
        workflowSchemaVersion: 999,
      }),
    ).toThrow('Workflow schema version is unsupported');
  });

  it.each([
    { runProtocolVersion: 999, workflowSchemaVersion: 1 },
    { runProtocolVersion: 2, workflowSchemaVersion: 999 },
  ])(
    'rejects an incompatible claimed job before creating a browser session',
    async (versions) => {
      const create = vi.fn();
      const worker = new RunJobWorker(
        {
          claimJob: vi.fn().mockResolvedValue({
            schemaVersion: 1,
            status: 'claimed',
            job: versions,
          }),
        } as unknown as RunnerJobTransport,
        { create } as unknown as BrowserSessionFactory,
        abortableClock(),
        { write: vi.fn() },
        '0.1.0',
      );
      await expect(
        worker.runLoop(credential, new AbortController().signal),
      ).rejects.toThrow('unsupported');
      expect(create).not.toHaveBeenCalled();
    },
  );

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

  it('includes an in-flight claim in the maintenance quiescence barrier', async () => {
    let settleClaim: ((value: {
      schemaVersion: 1;
      status: 'no_job';
      pollAfterSeconds: number;
    }) => void) | undefined;
    const pendingClaim = new Promise<{
      schemaVersion: 1;
      status: 'no_job';
      pollAfterSeconds: number;
    }>((resolve) => {
      settleClaim = resolve;
    });
    const claimJob = vi.fn().mockReturnValue(pendingClaim);
    const worker = new RunJobWorker(
      { claimJob } as unknown as RunnerJobTransport,
      {} as BrowserSessionFactory,
      abortableClock(),
      { write: vi.fn() },
      '0.1.0',
    );
    const shutdown = new AbortController();
    const running = worker.runLoop(credential, shutdown.signal);
    await vi.waitFor(() => expect(claimJob).toHaveBeenCalledOnce());

    worker.pauseClaims();
    expect(worker.acceptsNewJobs()).toBe(false);
    expect(worker.hasUnsettledWork()).toBe(true);
    let quiescent = false;
    const waiting = worker.waitForQuiescence().then(() => {
      quiescent = true;
    });
    await Promise.resolve();
    expect(quiescent).toBe(false);

    settleClaim?.({
      schemaVersion: 1,
      status: 'no_job',
      pollAfterSeconds: 30,
    });
    await waiting;
    expect(worker.hasUnsettledWork()).toBe(false);
    expect(claimJob).toHaveBeenCalledOnce();

    shutdown.abort();
    await expect(running).resolves.toBeUndefined();
  });

  it('can reopen claim admission after a maintenance attempt is abandoned', async () => {
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
    const shutdown = new AbortController();
    const running = worker.runLoop(credential, shutdown.signal);
    await vi.waitFor(() => expect(claimJob).toHaveBeenCalledOnce());
    worker.pauseClaims();
    await worker.waitForQuiescence();

    worker.resumeClaims();
    await vi.waitFor(() => expect(claimJob).toHaveBeenCalledTimes(2));
    worker.pauseClaims();
    await worker.waitForQuiescence();
    shutdown.abort();
    await expect(running).resolves.toBeUndefined();
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
