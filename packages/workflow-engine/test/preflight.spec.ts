import { describe, expect, it } from 'vitest';

import { WorkflowEngine } from '../src/index.js';
import { EXECUTION_ID, FakeAdapter, executionRequest } from './helpers.js';

function run(input: unknown, adapter = new FakeAdapter()) {
  return {
    adapter,
    result: new WorkflowEngine(adapter, {
      createExecutionId: () => EXECUTION_ID,
    }).execute(input),
  };
}

describe('workflow engine preflight', () => {
  it('starts the adapter for a valid request', async () => {
    const context = run(executionRequest(['only']));
    await expect(context.result).resolves.toMatchObject({
      status: 'succeeded',
    });
    expect(context.adapter.startCount).toBe(1);
  });

  it.each([
    {
      name: 'invalid workflow',
      mutate: (request: ReturnType<typeof executionRequest>) => {
        request.workflow.steps = [];
      },
      code: 'INVALID_WORKFLOW',
    },
    {
      name: 'missing input',
      mutate: (request: ReturnType<typeof executionRequest>) => {
        request.workflow.variables = [
          { name: 'customer', valueType: 'string', required: true },
        ];
      },
      code: 'INVALID_RUNTIME_INPUTS',
    },
    {
      name: 'invalid timeout',
      mutate: (request: ReturnType<typeof executionRequest>) => {
        request.options.totalTimeoutMs = 1;
      },
      code: 'INVALID_EXECUTION_TIMEOUT',
    },
  ])('does not start the adapter for $name', async ({ mutate, code }) => {
    const request = executionRequest();
    mutate(request);
    const context = run(request);
    const result = await context.result;
    expect(result).toMatchObject({
      status: 'failed',
      terminationCause: 'preflight_failed',
      error: { code },
    });
    expect(context.adapter.startCount).toBe(0);
  });

  it('rejects unresolved secrets before adapter startup', async () => {
    const request = executionRequest(['secret']);
    request.workflow.steps = [
      {
        id: 'secret',
        type: 'fill',
        name: 'Secret',
        locator: { kind: 'label', value: 'Password' },
        value: { kind: 'secret', secretName: 'crmPassword' },
      },
    ];
    const context = run(request);
    const result = await context.result;
    expect(result.error?.code).toBe('SECRET_RESOLUTION_UNAVAILABLE');
    expect(result.steps).toEqual([
      expect.objectContaining({
        stepId: 'secret',
        status: 'skipped',
        skippedReason: 'preflight_failed',
      }),
    ]);
    expect(context.adapter.startCount).toBe(0);
  });

  it('rejects unsupported steps before adapter startup', async () => {
    const request = executionRequest(['verify']);
    request.workflow.steps = [
      {
        id: 'verify',
        type: 'verify',
        name: 'Verify',
        assertion: {
          kind: 'visible',
          locator: { kind: 'text', value: 'Complete' },
        },
      },
    ];
    const context = run(request);
    const result = await context.result;
    expect(result.error?.code).toBe('UNSUPPORTED_STEP_TYPE');
    expect(context.adapter.startCount).toBe(0);
  });
});
