import { randomUUID } from 'node:crypto';

import type { StoredRunnerCredential } from '@tasktwin/runner-protocol';
import type {
  RecoveryCoordinatorRequest,
  RecoveryCoordinatorResult,
  RunnerRepairStatus,
} from '@tasktwin/workflow-recovery';
import type { WorkflowRecoveryCoordinator } from '@tasktwin/workflow-engine';

import type { RunnerJobTransport } from '../control-plane-client.js';
import type { LocatorRepairBrowserBridge } from '../locator-repair/browser-bridge.js';
import { discoverLocatorRepairProposal } from '../locator-repair/candidate-discovery.js';
import { testLocatorRepairCandidate } from '../locator-repair/candidate-tester.js';

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      finish();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class HttpRecoveryCoordinator implements WorkflowRecoveryCoordinator {
  constructor(
    private readonly transport: RunnerJobTransport,
    private readonly credential: StoredRunnerCredential,
    private readonly runId: string,
    private readonly leaseToken: string,
    private readonly beforeCreate: () => Promise<void> = async () => undefined,
    private readonly locatorRepairBridge?: LocatorRepairBrowserBridge,
  ) {}

  async awaitRepair(
    request: RecoveryCoordinatorRequest,
    signal: AbortSignal,
  ): Promise<RecoveryCoordinatorResult> {
    if (
      this.transport.createRepairRequest === undefined ||
      this.transport.getRepairStatus === undefined
    ) {
      throw new Error('Manual repair transport is unavailable.');
    }
    await this.beforeCreate();
    const clientRequestId = randomUUID();
    const created = await this.transport.createRepairRequest(
      this.credential,
      this.runId,
      this.leaseToken,
      {
        clientRequestId,
        stepId: request.stepId,
        attemptNumber: request.attemptNumber,
        safeErrorCode: request.safeErrorCode,
        effectCertainty: request.effectCertainty,
        expiresAt: request.expiresAt,
      },
    );
    let current: RunnerRepairStatus = {
      schemaVersion: 1,
      status: created.status,
      retryAllowed: created.retryAllowed,
      requestedAt: created.requestedAt,
      expiresAt: created.expiresAt,
      resolvedAt: null,
      pollAfterSeconds: created.pollAfterSeconds,
    };
    let proposalId: string | undefined;
    if (!created.retryAllowed && this.locatorRepairBridge !== undefined) {
      const session = this.locatorRepairBridge.current();
      if (
        session !== null &&
        this.transport.getLocatorRepairDiscoverySeed !== undefined &&
        this.transport.createLocatorRepairProposal !== undefined
      ) {
        const seed = await this.transport.getLocatorRepairDiscoverySeed(
          this.credential,
          this.runId,
          this.leaseToken,
          created.repairRequestId,
        );
        const proposal = await discoverLocatorRepairProposal({
          page: session.page,
          seed,
          pageContextDigest: session.currentPageContextDigest(),
          generatedAt: new Date().toISOString(),
        });
        const persisted = await this.transport.createLocatorRepairProposal(
          this.credential,
          this.runId,
          this.leaseToken,
          proposal,
        );
        proposalId = persisted.proposalId;
      }
    }
    while (current.status === 'PENDING' && !signal.aborted) {
      await wait(current.pollAfterSeconds * 1_000, signal);
      if (signal.aborted) break;
      if (
        proposalId !== undefined &&
        this.transport.pollLocatorRepairProposal !== undefined &&
        this.transport.submitLocatorRepairCandidateTestResult !== undefined
      ) {
        const polled = await this.transport.pollLocatorRepairProposal(
          this.credential,
          this.runId,
          this.leaseToken,
          proposalId,
        );
        const session = this.locatorRepairBridge?.current();
        if (
          polled.command !== null &&
          session !== null &&
          session !== undefined
        ) {
          const result = await testLocatorRepairCandidate({
            session,
            command: polled.command,
            clientTestResultId: randomUUID(),
          });
          await this.transport.submitLocatorRepairCandidateTestResult(
            this.credential,
            this.runId,
            this.leaseToken,
            proposalId,
            polled.command.candidateId,
            result,
          );
        }
      }
      current = await this.transport.getRepairStatus(
        this.credential,
        this.runId,
        this.leaseToken,
        created.repairRequestId,
      );
    }
    if (signal.aborted) {
      return {
        repairRequestId: created.repairRequestId,
        decision: 'cancelled',
        decidedAt: new Date().toISOString(),
      };
    }
    const decision = {
      RETRY_APPROVED: 'retry',
      ABORTED: 'abort',
      EXPIRED: 'expired',
      CANCELLED: 'cancelled',
      INVALIDATED: 'invalidated',
    } as const;
    if (current.status === 'PENDING') {
      throw new Error('Repair request did not reach a terminal state.');
    }
    return {
      repairRequestId: created.repairRequestId,
      decision: decision[current.status],
      decidedAt: current.resolvedAt ?? new Date().toISOString(),
    };
  }
}
