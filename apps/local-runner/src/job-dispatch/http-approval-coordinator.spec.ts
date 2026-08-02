import type { StoredRunnerCredential } from '@tasktwin/runner-protocol';
import { describe, expect, it, vi } from 'vitest';

import type { RunnerJobTransport } from '../control-plane-client.js';
import { HttpApprovalCoordinator } from './http-approval-coordinator.js';

const credential = {
  controlPlaneOrigin: 'http://127.0.0.1:3001',
  runnerDeviceId: '00000000-0000-4000-8000-000000000021',
  credential: 'x'.repeat(43),
} as StoredRunnerCredential;

function transport(status: 'APPROVED' | 'REJECTED'): RunnerJobTransport {
  return {
    claimJob: vi.fn(),
    renewJobLease: vi.fn(),
    sendProgress: vi.fn(),
    completeJob: vi.fn(),
    createApprovalRequest: vi.fn(async () => ({
      approvalRequestId: '00000000-0000-4000-8000-000000000022',
      status: 'PENDING',
      requestedAt: '2026-08-02T00:00:00.000Z',
      expiresAt: '2026-08-02T00:02:00.000Z',
      pollAfterSeconds: 1,
      idempotent: false,
    })),
    getApprovalStatus: vi.fn(async () => ({
      status,
      requestedAt: '2026-08-02T00:00:00.000Z',
      expiresAt: '2026-08-02T00:02:00.000Z',
      resolvedAt: '2026-08-02T00:00:01.000Z',
      pollAfterSeconds: 1,
    })),
  } as RunnerJobTransport;
}

const request = {
  executionId: '00000000-0000-4000-8000-000000000023',
  workflowId: 'approvalFixture',
  workflowVersion: 1,
  approvalStepId: 'approveSubmit',
  gatedStepId: 'submit',
  riskLevel: 'high' as const,
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
};

describe('HttpApprovalCoordinator', () => {
  it.each([
    ['APPROVED', 'approved'],
    ['REJECTED', 'rejected'],
  ] as const)(
    'maps %s without exposing approval metadata',
    async (status, decision) => {
      vi.useFakeTimers();
      try {
        const current = transport(status);
        const pending = new HttpApprovalCoordinator(
          current,
          credential,
          request.executionId,
          'lease-token',
        ).awaitApproval(request, new AbortController().signal);
        await vi.advanceTimersByTimeAsync(1_000);
        await expect(pending).resolves.toEqual({
          decision,
          decidedAt: '2026-08-02T00:00:01.000Z',
        });
        expect(current.createApprovalRequest).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('returns cancellation promptly when the execution aborts', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const pending = new HttpApprovalCoordinator(
        transport('APPROVED'),
        credential,
        request.executionId,
        'lease-token',
      ).awaitApproval(request, controller.signal);
      await vi.advanceTimersByTimeAsync(0);
      controller.abort();
      await expect(pending).resolves.toMatchObject({ decision: 'cancelled' });
    } finally {
      vi.useRealTimers();
    }
  });
});
