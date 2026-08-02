import { randomUUID } from 'node:crypto';

import type {
  ApprovalCoordinatorRequest,
  ApprovalCoordinatorResult,
} from '@tasktwin/workflow-approval';
import type { WorkflowApprovalCoordinator } from '@tasktwin/workflow-engine';
import type { StoredRunnerCredential } from '@tasktwin/runner-protocol';

import type { RunnerJobTransport } from '../control-plane-client.js';

function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const timeout = setTimeout(finish, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timeout);
      finish();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class HttpApprovalCoordinator implements WorkflowApprovalCoordinator {
  constructor(
    private readonly transport: RunnerJobTransport,
    private readonly credential: StoredRunnerCredential,
    private readonly runId: string,
    private readonly leaseToken: string,
  ) {}

  async awaitApproval(
    request: ApprovalCoordinatorRequest,
    signal: AbortSignal,
  ): Promise<ApprovalCoordinatorResult> {
    const clientRequestId = randomUUID();
    let created: Awaited<
      ReturnType<RunnerJobTransport['createApprovalRequest']>
    > | null = null;
    for (let attempt = 0; attempt < 3 && created === null; attempt += 1) {
      try {
        created = await this.transport.createApprovalRequest(
          this.credential,
          this.runId,
          this.leaseToken,
          {
            clientRequestId,
            approvalStepId: request.approvalStepId,
            gatedStepId: request.gatedStepId,
            expiresAt: request.expiresAt,
          },
        );
      } catch {
        if (attempt === 2) throw new Error('Approval request failed.');
      }
    }
    if (created === null) throw new Error('Approval request failed.');
    let status = created.status;
    let resolvedAt: string | null = null;
    let pollAfterSeconds = created.pollAfterSeconds;
    while (status === 'PENDING' && !signal.aborted) {
      await sleep(pollAfterSeconds * 1_000, signal);
      if (signal.aborted) break;
      const current = await this.transport.getApprovalStatus(
        this.credential,
        this.runId,
        this.leaseToken,
        created.approvalRequestId,
      );
      status = current.status;
      resolvedAt = current.resolvedAt;
      pollAfterSeconds = current.pollAfterSeconds;
    }
    if (signal.aborted) {
      return { decision: 'cancelled', decidedAt: new Date().toISOString() };
    }
    const decision = {
      APPROVED: 'approved',
      REJECTED: 'rejected',
      EXPIRED: 'expired',
      CANCELLED: 'cancelled',
      INVALIDATED: 'invalidated',
    } as const;
    if (status === 'PENDING') throw new Error('Approval request failed.');
    return {
      decision: decision[status],
      decidedAt: resolvedAt ?? new Date().toISOString(),
    };
  }
}
