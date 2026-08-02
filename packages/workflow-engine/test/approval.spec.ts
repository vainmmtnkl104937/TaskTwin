import type {
  ApprovalCoordinatorRequest,
  ApprovalCoordinatorResult,
} from '@tasktwin/workflow-approval';
import { describe, expect, it } from 'vitest';

import {
  WorkflowEngine,
  type WorkflowApprovalCoordinator,
  type WorkflowProgressEvent,
} from '../src/index.js';
import {
  EXECUTION_ID,
  FakeAdapter,
  executionRequest,
  waitFor,
} from './helpers.js';

class FakeApprovalCoordinator implements WorkflowApprovalCoordinator {
  readonly requests: ApprovalCoordinatorRequest[] = [];

  constructor(private readonly result: ApprovalCoordinatorResult) {}

  async awaitApproval(
    request: ApprovalCoordinatorRequest,
  ): Promise<ApprovalCoordinatorResult> {
    this.requests.push(request);
    return this.result;
  }
}

function approvalRequest() {
  const request = executionRequest([]);
  request.workflow.steps = [
    {
      id: 'approveSubmit',
      type: 'approval',
      name: 'Approve submit',
      message: 'Review the pending submit action.',
      riskLevel: 'high',
      scope: 'next_step',
      timeoutMs: 30_000,
    },
    {
      id: 'submit',
      type: 'click',
      name: 'Submit',
      locator: { kind: 'testId', value: 'submit' },
    },
  ];
  return request;
}

function coordinatorResult(
  decision: ApprovalCoordinatorResult['decision'],
): ApprovalCoordinatorResult {
  return {
    decision,
    decidedAt: '2026-01-01T00:00:01.000Z',
  };
}

describe('approval orchestration', () => {
  it('waits without calling the browser adapter and continues after approval', async () => {
    const adapter = new FakeAdapter();
    const coordinator = new FakeApprovalCoordinator(
      coordinatorResult('approved'),
    );
    const events: WorkflowProgressEvent[] = [];
    const result = await new WorkflowEngine(adapter, {
      createExecutionId: () => EXECUTION_ID,
      approvalCoordinator: coordinator,
      progressSink: { emit: (event) => events.push(event) },
    }).execute(approvalRequest());

    expect(result.status).toBe('succeeded');
    expect(adapter.executed).toEqual(['submit']);
    expect(coordinator.requests).toHaveLength(1);
    expect(result.steps.map((step) => step.status)).toEqual([
      'succeeded',
      'succeeded',
    ]);
    expect(
      events
        .filter((event) => event.kind === 'run_status_changed')
        .map((event) => event.status),
    ).toContain('waiting_for_approval');
    expect(JSON.stringify({ result, events })).not.toContain(
      'Review the pending submit action.',
    );
  });

  it('cancels and skips the gated step after rejection', async () => {
    const adapter = new FakeAdapter();
    const result = await new WorkflowEngine(adapter, {
      createExecutionId: () => EXECUTION_ID,
      approvalCoordinator: new FakeApprovalCoordinator(
        coordinatorResult('rejected'),
      ),
    }).execute(approvalRequest());

    expect(result.status).toBe('cancelled');
    expect(result.terminationCause).toBe('approval_rejected');
    expect(adapter.executed).toEqual([]);
    expect(result.steps[0]?.status).toBe('cancelled');
    expect(result.steps[1]?.skippedReason).toBe('approval_rejected');
    expect(adapter.stopCount).toBe(1);
  });

  it('times out and skips the gated step after approval expiry', async () => {
    const adapter = new FakeAdapter();
    const result = await new WorkflowEngine(adapter, {
      createExecutionId: () => EXECUTION_ID,
      approvalCoordinator: new FakeApprovalCoordinator(
        coordinatorResult('expired'),
      ),
    }).execute(approvalRequest());

    expect(result.status).toBe('timed_out');
    expect(result.terminationCause).toBe('approval_expired');
    expect(adapter.executed).toEqual([]);
    expect(result.steps[0]?.status).toBe('timed_out');
    expect(result.steps[1]?.skippedReason).toBe('approval_expired');
    expect(adapter.stopCount).toBe(1);
  });

  it('interrupts safely when the request is invalidated', async () => {
    const adapter = new FakeAdapter();
    const result = await new WorkflowEngine(adapter, {
      createExecutionId: () => EXECUTION_ID,
      approvalCoordinator: new FakeApprovalCoordinator(
        coordinatorResult('invalidated'),
      ),
    }).execute(approvalRequest());

    expect(result.status).toBe('interrupted');
    expect(result.terminationCause).toBe('approval_invalidated');
    expect(adapter.executed).toEqual([]);
    expect(result.steps[0]?.status).toBe('interrupted');
    expect(result.steps[1]?.skippedReason).toBe('approval_invalidated');
  });

  it('rejects an approval workflow before adapter startup without a coordinator', async () => {
    const adapter = new FakeAdapter();
    const result = await new WorkflowEngine(adapter, {
      createExecutionId: () => EXECUTION_ID,
    }).execute(approvalRequest());

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('APPROVAL_COORDINATOR_UNAVAILABLE');
    expect(adapter.startCount).toBe(0);
  });

  it('cancels a pending approval through the external signal and cleans up', async () => {
    const adapter = new FakeAdapter();
    const controller = new AbortController();
    const coordinator: WorkflowApprovalCoordinator = {
      awaitApproval: (_request, signal) =>
        new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () =>
              resolve({
                decision: 'cancelled',
                decidedAt: '2026-01-01T00:00:01.000Z',
              }),
            { once: true },
          );
        }),
    };
    const pending = new WorkflowEngine(adapter, {
      createExecutionId: () => EXECUTION_ID,
      approvalCoordinator: coordinator,
    }).execute(approvalRequest(), controller.signal);
    await waitFor(() => adapter.startCount === 1);
    controller.abort();
    const result = await pending;
    expect(result.status).toBe('cancelled');
    expect(result.steps[1]?.status).toBe('skipped');
    expect(adapter.executed).toEqual([]);
    expect(adapter.stopCount).toBe(1);
  });
});
