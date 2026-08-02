import { describe, expect, it } from 'vitest';
import type { WorkflowRecoveryCoordinator } from '../src/index.js';
import { WorkflowEngine } from '../src/index.js';

import { EXECUTION_ID, FakeAdapter, executionRequest } from './helpers.js';

function createEngine(
  adapter: FakeAdapter,
  recoveryCoordinator?: WorkflowRecoveryCoordinator,
) {
  return new WorkflowEngine(adapter, {
    createExecutionId: () => EXECUTION_ID,
    ...(recoveryCoordinator === undefined ? {} : { recoveryCoordinator }),
  });
}

function verifyRequest() {
  const request = executionRequest(['verify']);
  request.workflow.steps = [
    {
      id: 'verify',
      type: 'verify',
      name: 'Verify result',
      assertion: {
        kind: 'visible',
        locator: { kind: 'testId', value: 'result' },
      },
    },
  ];
  return request;
}

function extractRequest() {
  const request = executionRequest(['extract']);
  request.workflow.steps = [
    {
      id: 'extract',
      type: 'extract',
      name: 'Extract result',
      locator: { kind: 'testId', value: 'result' },
      source: { kind: 'text' },
      outputName: 'result',
      retention: 'ephemeral',
    },
  ];
  return request;
}

describe('bounded workflow recovery', () => {
  it('automatically retries a transient Verify once', async () => {
    const adapter = new FakeAdapter();
    adapter.behavior.set('verify', 'verify-transient-once');
    const result = await createEngine(adapter).execute(verifyRequest());
    expect(result.status).toBe('succeeded');
    expect(adapter.executed).toEqual(['verify', 'verify']);
    expect(
      result.steps[0]?.attempts?.map((attempt) => attempt.trigger),
    ).toEqual(['initial', 'automatic_retry']);
  });

  it('stops Extract retry at the automatic limit', async () => {
    const adapter = new FakeAdapter();
    adapter.behavior.set('extract', 'extract-transient-always');
    const result = await createEngine(adapter).execute(extractRequest());
    expect(result.status).toBe('failed');
    expect(adapter.executed).toEqual(['extract', 'extract']);
    expect(result.steps[0]?.attempts).toHaveLength(2);
  });

  it('never retries an action after a possible side effect', async () => {
    const adapter = new FakeAdapter();
    adapter.behavior.set('first', 'click-side-effect');
    const request = executionRequest(['first', 'later']);
    request.options.recoveryMode = 'automatic_safe_and_manual';
    const coordinator: WorkflowRecoveryCoordinator = {
      awaitRepair: async () => {
        throw new Error('must not be called');
      },
    };
    const result = await createEngine(adapter, coordinator).execute(request);
    expect(adapter.executed).toEqual(['first']);
    expect(result.steps[0]?.attempts).toHaveLength(1);
    expect(result.steps[1]?.status).toBe('skipped');
  });

  it('waits for repair and retries only the failed Fill step', async () => {
    const adapter = new FakeAdapter();
    adapter.behavior.set('fill', 'fill-preaction-once');
    const request = executionRequest(['before', 'fill', 'after']);
    request.workflow.steps[1] = {
      id: 'fill',
      type: 'fill',
      name: 'Fill customer',
      locator: { kind: 'label', value: 'Customer' },
      value: { kind: 'literal', value: 'safe fixture' },
    };
    request.options.recoveryMode = 'automatic_safe_and_manual';
    const coordinator: WorkflowRecoveryCoordinator = {
      awaitRepair: async () => ({
        repairRequestId: '00000000-0000-4000-8000-000000000099',
        decision: 'retry',
        decidedAt: '2026-08-02T00:00:01.000Z',
      }),
    };
    const result = await createEngine(adapter, coordinator).execute(request);
    expect(adapter.executed).toEqual(['before', 'fill', 'fill', 'after']);
    expect(
      result.steps[1]?.attempts?.map((attempt) => attempt.trigger),
    ).toEqual(['initial', 'manual_retry']);
    expect(JSON.stringify(result)).not.toContain('safe fixture');
  });

  it.each([
    ['abort', 'cancelled'],
    ['expired', 'timed_out'],
    ['invalidated', 'interrupted'],
  ] as const)('maps %s repair to %s', async (decision, status) => {
    const adapter = new FakeAdapter();
    adapter.behavior.set('fill', 'fill-preaction-once');
    const request = executionRequest(['fill', 'later']);
    request.workflow.steps[0] = {
      id: 'fill',
      type: 'fill',
      name: 'Fill customer',
      locator: { kind: 'label', value: 'Customer' },
      value: { kind: 'literal', value: 'hidden' },
    };
    request.options.recoveryMode = 'automatic_safe_and_manual';
    const result = await createEngine(adapter, {
      awaitRepair: async () => ({
        repairRequestId: '00000000-0000-4000-8000-000000000099',
        decision,
        decidedAt: '2026-08-02T00:00:01.000Z',
      }),
    }).execute(request);
    expect(result.status).toBe(status);
    expect(adapter.executed).toEqual(['fill']);
    expect(adapter.stopCount).toBe(1);
  });
});
