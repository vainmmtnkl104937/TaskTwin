import type { StoredRunnerCredential } from '@tasktwin/runner-protocol';
import { describe, expect, it, vi } from 'vitest';

import type { RunnerJobTransport } from '../control-plane-client.js';
import { HttpRecoveryCoordinator } from './http-recovery-coordinator.js';

const credential = {
  controlPlaneOrigin: 'http://127.0.0.1:3001',
  runnerDeviceId: '00000000-0000-4000-8000-000000000041',
  credential: 'x'.repeat(43),
} as StoredRunnerCredential;

function transport(status: 'RETRY_APPROVED' | 'ABORTED'): RunnerJobTransport {
  return {
    claimJob: vi.fn(),
    renewJobLease: vi.fn(),
    sendProgress: vi.fn(),
    completeJob: vi.fn(),
    createApprovalRequest: vi.fn(),
    getApprovalStatus: vi.fn(),
    createRepairRequest: vi.fn(async () => ({
      schemaVersion: 1 as const,
      repairRequestId: '00000000-0000-4000-8000-000000000042',
      status: 'PENDING' as const,
      retryAllowed: true,
      requestedAt: '2026-08-02T00:00:00.000Z',
      expiresAt: '2026-08-02T00:02:00.000Z',
      pollAfterSeconds: 1,
      idempotent: false,
    })),
    getRepairStatus: vi.fn(async () => ({
      schemaVersion: 1 as const,
      status,
      retryAllowed: status === 'RETRY_APPROVED',
      requestedAt: '2026-08-02T00:00:00.000Z',
      expiresAt: '2026-08-02T00:02:00.000Z',
      resolvedAt: '2026-08-02T00:00:01.000Z',
      pollAfterSeconds: 1,
    })),
  };
}

const request = {
  executionId: '00000000-0000-4000-8000-000000000043',
  workflowId: 'repairFixture',
  workflowVersion: 1,
  stepId: 'fillEmail',
  stepIndex: 1,
  stepType: 'fill',
  attemptNumber: 1,
  safeErrorCode: 'LOCATOR_NOT_FOUND',
  effectCertainty: 'not_started' as const,
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
};

describe('HttpRecoveryCoordinator', () => {
  it.each([
    ['RETRY_APPROVED', 'retry'],
    ['ABORTED', 'abort'],
  ] as const)(
    'maps %s into a safe engine decision',
    async (status, decision) => {
      vi.useFakeTimers();
      try {
        const current = transport(status);
        const pending = new HttpRecoveryCoordinator(
          current,
          credential,
          request.executionId,
          'lease-token',
        ).awaitRepair(request, new AbortController().signal);
        await vi.advanceTimersByTimeAsync(1_000);
        await expect(pending).resolves.toEqual({
          repairRequestId: '00000000-0000-4000-8000-000000000042',
          decision,
          decidedAt: '2026-08-02T00:00:01.000Z',
        });
        expect(current.createRepairRequest).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('returns cancellation promptly while waiting', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const pending = new HttpRecoveryCoordinator(
        transport('RETRY_APPROVED'),
        credential,
        request.executionId,
        'lease-token',
      ).awaitRepair(request, controller.signal);
      await vi.advanceTimersByTimeAsync(0);
      controller.abort();
      await expect(pending).resolves.toMatchObject({ decision: 'cancelled' });
    } finally {
      vi.useRealTimers();
    }
  });
});
