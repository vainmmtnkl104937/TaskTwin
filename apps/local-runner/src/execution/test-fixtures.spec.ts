import type { WorkflowDefinition } from '@tasktwin/workflow-schema';
import { describe, expect, it } from 'vitest';

import {
  LocalExecutionRequestSchema,
  MAX_ACTION_TIMEOUT_MS,
} from './contracts.js';
import { SafeExecutionException } from './errors.js';
import { prepareLocalExecution } from './workflow-executor.js';

function workflow(
  steps: WorkflowDefinition['steps'] = [
    {
      id: 'navigate',
      type: 'navigate',
      name: 'Navigate',
      url: { kind: 'variable', variableName: 'targetUrl' },
    },
    {
      id: 'fill',
      type: 'fill',
      name: 'Fill',
      locator: { kind: 'label', value: 'Customer name' },
      value: { kind: 'variable', variableName: 'customerName' },
    },
  ],
): WorkflowDefinition {
  return {
    schemaVersion: 1,
    workflowId: 'executionTest',
    version: 1,
    name: 'Execution test',
    status: 'draft',
    variables: [
      { name: 'targetUrl', valueType: 'string', required: true },
      { name: 'customerName', valueType: 'string', required: true },
    ],
    steps,
  };
}

function request(steps?: WorkflowDefinition['steps']) {
  return {
    schemaVersion: 1,
    workflow: workflow(steps),
    inputs: {
      schemaVersion: 1,
      values: {
        targetUrl: { kind: 'string', value: 'http://127.0.0.1:4177/' },
        customerName: { kind: 'string', value: 'private runtime value' },
      },
    },
    allowedOrigins: ['http://127.0.0.1:4177'],
    options: {
      headless: true,
      actionTimeoutMs: 1_000,
      navigationTimeoutMs: 1_000,
      executionTimeoutMs: 10_000,
    },
  };
}

describe('local execution validation and preflight', () => {
  it('accepts a complete valid request', () => {
    expect(LocalExecutionRequestSchema.safeParse(request()).success).toBe(true);
    expect(prepareLocalExecution(request()).steps).toHaveLength(2);
  });

  it('rejects invalid workflows, missing and unknown runtime variables', () => {
    const invalidWorkflow = request();
    invalidWorkflow.workflow.steps = [];
    expect(() => prepareLocalExecution(invalidWorkflow)).toThrow(
      SafeExecutionException,
    );

    const missing = request();
    delete (missing.inputs.values as Record<string, unknown>).customerName;
    expect(() => prepareLocalExecution(missing)).toThrow(
      expect.objectContaining({
        safe: expect.objectContaining({ code: 'INVALID_RUNTIME_INPUTS' }),
      }),
    );

    const unknown = request();
    Object.assign(unknown.inputs.values, {
      unexpected: { kind: 'string', value: 'not returned' },
    });
    expect(() => prepareLocalExecution(unknown)).toThrow(
      expect.objectContaining({
        safe: expect.objectContaining({ code: 'INVALID_RUNTIME_INPUTS' }),
      }),
    );
  });

  it.each([
    'not-an-origin',
    'file:///tmp',
    'https://user:password@example.test',
    'https://example.test/path',
  ])('rejects invalid allowed origin %s', (origin) => {
    const input = request();
    input.allowedOrigins = [origin];
    expect(LocalExecutionRequestSchema.safeParse(input).success).toBe(false);
  });

  it.each(['file:///tmp/page', 'data:text/html,unsafe', 'javascript:alert(1)'])(
    'rejects unsafe navigation %s before browser launch',
    (url) => {
      const input = request();
      input.inputs.values.targetUrl.value = url;
      expect(() => prepareLocalExecution(input)).toThrow(
        expect.objectContaining({
          safe: expect.objectContaining({ code: 'UNSAFE_URL_SCHEME' }),
        }),
      );
    },
  );

  it('rejects credential-bearing and disallowed navigation URLs', () => {
    for (const url of [
      'http://user:password@127.0.0.1:4177/',
      'https://example.test/',
    ]) {
      const input = request();
      input.inputs.values.targetUrl.value = url;
      expect(() => prepareLocalExecution(input)).toThrow(
        SafeExecutionException,
      );
    }
  });

  it('rejects secret requirements before browser launch', () => {
    const input = request([
      {
        id: 'secret',
        type: 'fill',
        name: 'Secret fill',
        locator: { kind: 'label', value: 'Customer name' },
        value: { kind: 'secret', secretName: 'crmPassword' },
      },
    ]);
    input.workflow.variables = [];
    input.inputs.values = {} as typeof input.inputs.values;
    expect(() => prepareLocalExecution(input)).toThrow(
      expect.objectContaining({
        safe: expect.objectContaining({
          code: 'SECRET_RESOLUTION_UNAVAILABLE',
        }),
      }),
    );
  });

  it('rejects unsupported steps before browser launch', () => {
    const input = request([
      {
        id: 'verify',
        type: 'verify',
        name: 'Verify',
        assertion: {
          kind: 'visible',
          locator: { kind: 'text', value: 'Complete' },
        },
      },
    ]);
    input.workflow.variables = [];
    input.inputs.values = {} as typeof input.inputs.values;
    expect(() => prepareLocalExecution(input)).toThrow(
      expect.objectContaining({
        safe: expect.objectContaining({ code: 'UNSUPPORTED_STEP_TYPE' }),
      }),
    );
  });

  it('enforces bounded execution options', () => {
    const input = request();
    input.options.actionTimeoutMs = MAX_ACTION_TIMEOUT_MS + 1;
    expect(LocalExecutionRequestSchema.safeParse(input).success).toBe(false);
  });
});
