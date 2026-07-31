import type { WorkflowDefinition } from '@tasktwin/workflow-schema';
import type { Locator, Page } from 'playwright';
import { describe, expect, it, vi } from 'vitest';

import type { BrowserSessionFactory } from './browser-session.js';
import { safeError } from './errors.js';
import { LocalWorkflowExecutor } from './workflow-executor.js';

function executionRequest(steps: WorkflowDefinition['steps']) {
  return {
    schemaVersion: 1,
    workflow: {
      schemaVersion: 1,
      workflowId: 'executorTest',
      version: 1,
      name: 'Executor test',
      status: 'draft',
      variables: [
        { name: 'targetUrl', valueType: 'string', required: true },
        { name: 'customerName', valueType: 'string', required: true },
      ],
      steps,
    },
    inputs: {
      schemaVersion: 1,
      values: {
        targetUrl: { kind: 'string', value: 'http://127.0.0.1:4177/' },
        customerName: { kind: 'string', value: 'never render this value' },
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

function setup(failClick = false) {
  const calls: string[] = [];
  const locatorMock = {
    first: vi.fn(),
    waitFor: vi.fn(async () => {
      calls.push('waitFor');
    }),
    count: vi.fn().mockResolvedValue(1),
    click: vi.fn(async () => {
      calls.push('click');
      if (failClick) {
        throw new Error('raw private browser error');
      }
    }),
    fill: vi.fn(async () => {
      calls.push('fill');
    }),
    selectOption: vi.fn(async () => {
      calls.push('select');
    }),
    setChecked: vi.fn(async () => {
      calls.push('setChecked');
    }),
  };
  const locator = locatorMock as unknown as Locator;
  locatorMock.first.mockReturnValue(locator);
  const page = {
    getByTestId: vi.fn().mockReturnValue(locator),
    getByLabel: vi.fn().mockReturnValue(locator),
    getByRole: vi.fn().mockReturnValue(locator),
  } as unknown as Page;
  const close = vi.fn().mockResolvedValue(null);
  const create = vi.fn().mockResolvedValue({ page, close });
  const executor = new LocalWorkflowExecutor({
    create,
  } as BrowserSessionFactory);
  return { calls, locator, page, close, create, executor };
}

describe('LocalWorkflowExecutor', () => {
  it('executes sequentially and reports attempted steps without raw values', async () => {
    const context = setup();
    const result = await context.executor.execute(
      executionRequest([
        {
          id: 'fill',
          type: 'fill',
          name: 'Fill',
          locator: { kind: 'label', value: 'Customer name' },
          value: { kind: 'variable', variableName: 'customerName' },
        },
        {
          id: 'check',
          type: 'setChecked',
          name: 'Check',
          locator: { kind: 'label', value: 'Confirm fixture' },
          checked: true,
        },
        {
          id: 'select',
          type: 'select',
          name: 'Select',
          locator: { kind: 'label', value: 'Required option' },
          value: { kind: 'literal', value: 'second' },
        },
      ]),
    );

    expect(result.status).toBe('succeeded');
    expect(result.steps.map((step) => step.stepId)).toEqual([
      'fill',
      'check',
      'select',
    ]);
    expect(context.calls.filter((call) => call !== 'waitFor')).toEqual([
      'fill',
      'setChecked',
      'select',
    ]);
    expect(context.close).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain('never render this value');
    expect(JSON.stringify(result)).not.toContain('second');
  });

  it('stops after the first failed step and closes resources', async () => {
    const context = setup(true);
    const result = await context.executor.execute(
      executionRequest([
        {
          id: 'fails',
          type: 'click',
          name: 'Fails',
          locator: { kind: 'testId', value: 'failure' },
        },
        {
          id: 'mustNotRun',
          type: 'click',
          name: 'Must not run',
          locator: { kind: 'testId', value: 'later' },
        },
      ]),
    );

    expect(result.status).toBe('failed');
    expect(result.counts.attempted).toBe(1);
    expect(result.failedStepId).toBe('fails');
    expect(result.steps[0]?.error?.code).toBe('ACTION_FAILED');
    expect(JSON.stringify(result)).not.toContain('raw private browser error');
    expect(context.locator.click).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('reports cleanup failure without exposing its cause', async () => {
    const context = setup();
    context.close.mockResolvedValueOnce(safeError('RESOURCE_CLEANUP_FAILED'));
    const result = await context.executor.execute(
      executionRequest([
        {
          id: 'click',
          type: 'click',
          name: 'Click',
          locator: { kind: 'testId', value: 'safe' },
        },
      ]),
    );
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('RESOURCE_CLEANUP_FAILED');
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'RESOURCE_CLEANUP_FAILED' }),
    );
  });

  it('never creates a browser session for unsafe URL or secret input', async () => {
    const context = setup();
    const unsafe = executionRequest([
      {
        id: 'navigate',
        type: 'navigate',
        name: 'Navigate',
        url: { kind: 'literal', value: 'file:///private' },
      },
    ]);
    unsafe.workflow.variables = [];
    unsafe.inputs.values = {} as typeof unsafe.inputs.values;
    await expect(context.executor.execute(unsafe)).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'UNSAFE_URL_SCHEME' },
    });

    const secret = executionRequest([
      {
        id: 'fill',
        type: 'fill',
        name: 'Fill',
        locator: { kind: 'label', value: 'Password' },
        value: { kind: 'secret', secretName: 'crmPassword' },
      },
    ]);
    secret.workflow.variables = [];
    secret.inputs.values = {} as typeof secret.inputs.values;
    await expect(context.executor.execute(secret)).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'SECRET_RESOLUTION_UNAVAILABLE' },
    });
    expect(context.create).not.toHaveBeenCalled();
  });
});
