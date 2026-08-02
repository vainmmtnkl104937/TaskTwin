import type { WorkflowDefinition } from '@tasktwin/workflow-schema';
import { describe, expect, it } from 'vitest';

import { PlaywrightWorkflowExecutionAdapter } from './playwright-workflow-execution-adapter.js';
import {
  LocalExecutionRequestSchema,
  MAX_ACTION_TIMEOUT_MS,
} from './contracts.js';
import { preflightWorkflowExecution } from '@tasktwin/workflow-engine';

const adapter = new PlaywrightWorkflowExecutionAdapter(
  {
    create: async () => {
      throw new Error('Preflight must not create a browser session.');
    },
  },
  {
    headless: true,
    actionTimeoutMs: 1_000,
    navigationTimeoutMs: 1_000,
  },
);

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
      totalTimeoutMs: 10_000,
      stepTimeoutMs: 1_000,
    },
  };
}

describe('local execution validation and preflight', () => {
  function preflight(input: ReturnType<typeof request>) {
    const local = LocalExecutionRequestSchema.parse(input);
    return preflightWorkflowExecution(
      {
        schemaVersion: local.schemaVersion,
        workflow: local.workflow,
        inputs: local.inputs,
        allowedOrigins: local.allowedOrigins,
        options: {
          totalTimeoutMs: local.options.totalTimeoutMs,
          stepTimeoutMs: local.options.stepTimeoutMs,
        },
      },
      adapter,
    );
  }

  it('accepts a complete valid request', () => {
    expect(LocalExecutionRequestSchema.safeParse(request()).success).toBe(true);
    expect(preflight(request()).ok).toBe(true);
  });

  it('rejects invalid workflows, missing and unknown runtime variables', () => {
    const invalidWorkflow = request();
    invalidWorkflow.workflow.steps = [];
    expect(preflight(invalidWorkflow)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_WORKFLOW' },
    });

    const missing = request();
    delete (missing.inputs.values as Record<string, unknown>).customerName;
    expect(preflight(missing)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_RUNTIME_INPUTS' },
    });

    const unknown = request();
    Object.assign(unknown.inputs.values, {
      unexpected: { kind: 'string', value: 'not returned' },
    });
    expect(preflight(unknown)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_RUNTIME_INPUTS' },
    });
  });

  it.each([
    'not-an-origin',
    'file:///tmp',
    'https://user:password@example.test',
    'https://example.test/path',
  ])('rejects invalid allowed origin %s', (origin) => {
    const input = request();
    input.allowedOrigins = [origin];
    expect(preflight(input).ok).toBe(false);
  });

  it.each(['file:///tmp/page', 'data:text/html,unsafe', 'javascript:alert(1)'])(
    'rejects unsafe navigation %s before browser launch',
    (url) => {
      const input = request();
      input.inputs.values.targetUrl.value = url;
      expect(preflight(input)).toMatchObject({
        ok: false,
        error: { code: 'UNSAFE_URL_SCHEME' },
      });
    },
  );

  it('rejects credential-bearing and disallowed navigation URLs', () => {
    for (const url of [
      'http://user:password@127.0.0.1:4177/',
      'https://example.test/',
    ]) {
      const input = request();
      input.inputs.values.targetUrl.value = url;
      expect(preflight(input).ok).toBe(false);
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
    expect(preflight(input)).toMatchObject({
      ok: false,
      error: { code: 'SECRET_RESOLUTION_UNAVAILABLE' },
    });
  });

  it('rejects unsupported steps before browser launch', () => {
    const input = request([
      {
        id: 'approval',
        type: 'approval',
        name: 'Approval',
        message: 'Approval is not executable.',
        riskLevel: 'medium',
        scope: 'next_step',
        timeoutMs: 30_000,
      },
    ]);
    input.workflow.variables = [];
    input.inputs.values = {} as typeof input.inputs.values;
    expect(preflight(input)).toMatchObject({
      ok: false,
      error: { code: 'APPROVAL_BINDING_INVALID' },
    });
  });

  it('enforces bounded execution options', () => {
    const input = request();
    input.options.actionTimeoutMs = MAX_ACTION_TIMEOUT_MS + 1;
    expect(LocalExecutionRequestSchema.safeParse(input).success).toBe(false);
  });
});
