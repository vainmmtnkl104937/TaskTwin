import { describe, expect, it } from 'vitest';

import {
  SafeExecutionException,
  WorkflowEngine,
  safeError,
  type WorkflowProgressEvent,
  RuntimeOutputStore,
} from '../src/index.js';
import { EXECUTION_ID, FakeAdapter, executionRequest } from './helpers.js';

function engine(adapter: FakeAdapter, events?: WorkflowProgressEvent[]) {
  return new WorkflowEngine(adapter, {
    createExecutionId: () => EXECUTION_ID,
    ...(events === undefined
      ? {}
      : { progressSink: { emit: (event) => events.push(event) } }),
  });
}

function extractionStore() {
  return new RuntimeOutputStore([
    {
      name: 'customerId',
      valueType: 'string',
      retention: 'ephemeral',
      producerStepId: 'extractCustomerId',
      producerStepIndex: 0,
    },
  ]);
}

describe('workflow execution orchestration', () => {
  it('keeps Extract output memory-only while resolving a later Fill', async () => {
    const request = executionRequest([]);
    request.workflow.steps = [
      {
        id: 'extractCustomerId',
        type: 'extract',
        name: 'Extract customer ID',
        locator: { kind: 'testId', value: 'customer-id' },
        source: { kind: 'text' },
        outputName: 'customerId',
        retention: 'ephemeral',
      },
      {
        id: 'fillCustomerId',
        type: 'fill',
        name: 'Fill customer ID',
        locator: { kind: 'label', value: 'Customer ID' },
        value: { kind: 'output', outputName: 'customerId' },
      },
    ];
    const adapter = new FakeAdapter();
    const events: WorkflowProgressEvent[] = [];
    const store = extractionStore();
    const result = await new WorkflowEngine(adapter, {
      createExecutionId: () => EXECUTION_ID,
      progressSink: { emit: (event) => events.push(event) },
      createRuntimeOutputStore: () => store,
    }).execute(request);
    expect(result.status).toBe('succeeded');
    expect(adapter.resolvedValues.get('fillCustomerId')).toBe(
      'ephemeral-customer-id',
    );
    expect(result.outputs).toEqual([
      {
        outputName: 'customerId',
        outputType: 'string',
        producerStepId: 'extractCustomerId',
        status: 'produced',
      },
    ]);
    const serialized = JSON.stringify({ events, result });
    expect(serialized).not.toContain('ephemeral-customer-id');
    expect(events.some((event) => event.kind === 'output_produced')).toBe(true);
    expect(store.size).toBe(0);
  });

  it('clears produced output after a later step fails', async () => {
    const request = executionRequest([]);
    request.workflow.steps = [
      {
        id: 'extractCustomerId',
        type: 'extract',
        name: 'Extract customer ID',
        locator: { kind: 'testId', value: 'customer-id' },
        source: { kind: 'text' },
        outputName: 'customerId',
        retention: 'ephemeral',
      },
      {
        id: 'failAfterExtract',
        type: 'click',
        name: 'Fail after extraction',
        locator: { kind: 'testId', value: 'missing' },
      },
    ];
    const adapter = new FakeAdapter();
    adapter.behavior.set('failAfterExtract', 'fail');
    const store = extractionStore();
    const result = await new WorkflowEngine(adapter, {
      createExecutionId: () => EXECUTION_ID,
      createRuntimeOutputStore: () => store,
    }).execute(request);
    expect(result.status).toBe('failed');
    expect(store.size).toBe(0);
  });

  it('rejects duplicate production and clears the store explicitly', () => {
    const store = extractionStore();
    store.set('customerId', 'string', 'first');
    expect(() => store.set('customerId', 'string', 'second')).toThrowError(
      expect.objectContaining({
        safe: expect.objectContaining({ code: 'DUPLICATE_OUTPUT_PRODUCTION' }),
      }),
    );
    store.clear();
    expect(store.size).toBe(0);
  });
  it('executes sequentially and returns every step with valid counts', async () => {
    const adapter = new FakeAdapter();
    const result = await engine(adapter).execute(executionRequest());
    expect(adapter.executed).toEqual(['first', 'second', 'third']);
    expect(adapter.maxActiveSteps).toBe(1);
    expect(result.status).toBe('succeeded');
    expect(result.steps.map((step) => step.stepId)).toEqual([
      'first',
      'second',
      'third',
    ]);
    expect(result.counts).toEqual({
      total: 3,
      attempted: 3,
      succeeded: 3,
      failed: 0,
      cancelled: 0,
      timedOut: 0,
      skipped: 0,
    });
    expect(adapter.stopCount).toBe(1);
  });

  it('stops at the first failure and skips all later steps', async () => {
    const adapter = new FakeAdapter();
    adapter.behavior.set('second', 'fail');
    const result = await engine(adapter).execute(executionRequest());
    expect(adapter.executed).toEqual(['first', 'second']);
    expect(result.status).toBe('failed');
    expect(result.failedStepId).toBe('second');
    expect(result.steps.map((step) => [step.stepId, step.status])).toEqual([
      ['first', 'succeeded'],
      ['second', 'failed'],
      ['third', 'skipped'],
    ]);
    expect(result.steps[2]?.skippedReason).toBe('prior_step_failed');
  });

  it('continues after Verify success and stops safely after Verify failure', async () => {
    const request = executionRequest(['before', 'verify', 'after']);
    request.workflow.steps[1] = {
      id: 'verify',
      type: 'verify',
      name: 'Verify outcome',
      assertion: {
        kind: 'text',
        locator: { kind: 'testId', value: 'result' },
        matchMode: 'exact',
        expected: { kind: 'literal', value: 'not-returned' },
      },
      timeoutMs: 500,
    };

    const successAdapter = new FakeAdapter();
    successAdapter.behavior.set('verify', 'verify-succeed');
    const success = await engine(successAdapter).execute(request);
    expect(success.status).toBe('succeeded');
    expect(success.steps[1]?.verification?.outcome).toBe('matched');

    const failureAdapter = new FakeAdapter();
    failureAdapter.behavior.set('verify', 'verify-fail');
    const failure = await engine(failureAdapter).execute(request);
    expect(failure.status).toBe('failed');
    expect(failure.steps[1]?.error?.code).toBe('VERIFICATION_NOT_MATCHED');
    expect(failure.steps[1]?.verification?.outcome).toBe('not_matched');
    expect(failure.steps[2]?.status).toBe('skipped');
    expect(JSON.stringify(failure)).not.toContain('not-returned');
  });

  it('preserves a primary step error when cleanup also fails', async () => {
    const adapter = new FakeAdapter();
    adapter.behavior.set('second', 'fail');
    adapter.cleanupError = safeError('RESOURCE_CLEANUP_FAILED');
    const result = await engine(adapter).execute(executionRequest());
    expect(result.terminationCause).toBe('step_failed');
    expect(result.error?.code).toBe('ACTION_FAILED');
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'RESOURCE_CLEANUP_FAILED' }),
    );
  });

  it('turns successful steps plus cleanup failure into safe run failure', async () => {
    const adapter = new FakeAdapter();
    adapter.cleanupError = safeError('RESOURCE_CLEANUP_FAILED');
    const result = await engine(adapter).execute(executionRequest(['only']));
    expect(result.status).toBe('failed');
    expect(result.terminationCause).toBe('cleanup_failed');
    expect(result.error?.code).toBe('RESOURCE_CLEANUP_FAILED');
    expect(result.steps[0]?.status).toBe('succeeded');
  });

  it('emits deterministic safe progress without raw input values', async () => {
    const request = executionRequest(['fill']);
    request.workflow.variables = [
      { name: 'customerName', valueType: 'string', required: true },
    ];
    request.workflow.steps = [
      {
        id: 'fill',
        type: 'fill',
        name: 'Fill',
        locator: { kind: 'label', value: 'Customer' },
        value: { kind: 'variable', variableName: 'customerName' },
      },
    ];
    request.inputs.values = {
      customerName: { kind: 'string', value: 'private runtime value' },
    };
    const adapter = new FakeAdapter();
    const events: WorkflowProgressEvent[] = [];
    const result = await engine(adapter, events).execute(request);
    expect(
      events.map(
        (event) =>
          `${event.kind}:${
            'status' in event
              ? event.status
              : event.kind === 'warning'
                ? event.warningCode
                : event.outputName
          }`,
      ),
    ).toEqual([
      'run_status_changed:pending',
      'run_status_changed:validating',
      'step_status_changed:pending',
      'run_status_changed:starting',
      'run_status_changed:running',
      'step_status_changed:running',
      'step_status_changed:succeeded',
      'run_status_changed:succeeded',
    ]);
    expect(JSON.stringify({ events, result })).not.toContain(
      'private runtime value',
    );
    expect(JSON.stringify({ events, result })).not.toContain('Customer');
  });

  it('reports a progress sink failure without repeating browser effects', async () => {
    const adapter = new FakeAdapter();
    const result = await new WorkflowEngine(adapter, {
      createExecutionId: () => EXECUTION_ID,
      progressSink: {
        emit: () => {
          throw new SafeExecutionException('ACTION_FAILED');
        },
      },
    }).execute(executionRequest(['only']));
    expect(result.status).toBe('succeeded');
    expect(adapter.executed).toEqual(['only']);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'PROGRESS_SINK_FAILED' }),
    );
  });

  it('reports a sink failure caused by the terminal progress event', async () => {
    const adapter = new FakeAdapter();
    const result = await new WorkflowEngine(adapter, {
      createExecutionId: () => EXECUTION_ID,
      progressSink: {
        emit: (event) => {
          if (
            event.kind === 'run_status_changed' &&
            event.status === 'succeeded'
          ) {
            throw new Error('unsafe sink detail');
          }
        },
      },
    }).execute(executionRequest(['only']));
    expect(result.status).toBe('succeeded');
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'PROGRESS_SINK_FAILED' }),
    );
    expect(JSON.stringify(result)).not.toContain('unsafe sink detail');
  });
});
