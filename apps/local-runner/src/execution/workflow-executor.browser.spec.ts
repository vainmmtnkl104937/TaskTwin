import { readFile } from 'node:fs/promises';

import { WorkflowRunInputSubmissionSchema } from '@tasktwin/workflow-inputs';
import {
  WorkflowDefinitionSchema,
  type WorkflowDefinition,
} from '@tasktwin/workflow-schema';
import { afterEach, describe, expect, it } from 'vitest';

import {
  startFixtureServer,
  type RunningFixtureServer,
} from './fixture-server.js';
import { PlaywrightBrowserSessionFactory } from './playwright-browser-session.js';
import { LocalWorkflowExecutor } from './workflow-executor.js';

const workflowFile = new URL(
  '../../fixtures/execution/workflow.v1.json',
  import.meta.url,
);
const inputsFile = new URL(
  '../../fixtures/execution/runtime-inputs.v1.json',
  import.meta.url,
);
const servers: RunningFixtureServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function fixture() {
  const server = await startFixtureServer();
  servers.push(server);
  const workflow = WorkflowDefinitionSchema.parse(
    JSON.parse(await readFile(workflowFile, 'utf8')) as unknown,
  );
  const baseInputs = WorkflowRunInputSubmissionSchema.parse(
    JSON.parse(await readFile(inputsFile, 'utf8')) as unknown,
  );
  const inputs = WorkflowRunInputSubmissionSchema.parse({
    ...baseInputs,
    values: {
      ...baseInputs.values,
      fixtureUrl: { kind: 'string', value: `${server.origin}/` },
    },
  });
  const request = {
    schemaVersion: 1,
    workflow,
    inputs,
    allowedOrigins: [server.origin],
    options: {
      headless: true,
      actionTimeoutMs: 5_000,
      navigationTimeoutMs: 10_000,
      totalTimeoutMs: 30_000,
      stepTimeoutMs: 10_000,
    },
  };
  return { server, request };
}

describe('Chromium local workflow integration', () => {
  it('executes the complete fixture and leaves only a safe result', async () => {
    const context = await fixture();
    const result = await new LocalWorkflowExecutor(
      new PlaywrightBrowserSessionFactory(),
    ).execute(context.request);

    expect(result.status, JSON.stringify(result)).toBe('succeeded');
    expect(result.counts.attempted).toBe(context.request.workflow.steps.length);
    expect(context.server.completed()).toBe(true);
    expect(result.outputs).toEqual([
      expect.objectContaining({ outputName: 'customerId', status: 'produced' }),
      expect.objectContaining({
        outputName: 'confirmedState',
        status: 'produced',
      }),
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('TaskTwin sample');
    expect(serialized).not.toContain('requiredOption');
    expect(serialized).not.toContain('?');
  });

  it.each([
    {
      locator: { kind: 'testId' as const, value: 'does-not-exist' },
      code: 'LOCATOR_NOT_FOUND',
    },
    {
      locator: {
        kind: 'text' as const,
        value: 'Duplicate action',
        exact: true,
      },
      code: 'LOCATOR_NOT_UNIQUE',
    },
  ])('returns $code and stops later steps', async ({ locator, code }) => {
    const context = await fixture();
    const first = context.request.workflow.steps[0];
    if (first === undefined) {
      throw new Error('Fixture must contain a navigate step.');
    }
    const workflow: WorkflowDefinition = {
      ...context.request.workflow,
      steps: [
        first,
        { id: 'failure', type: 'click', name: 'Failure', locator },
        {
          id: 'later',
          type: 'click',
          name: 'Later',
          locator: { kind: 'testId', value: 'open-form' },
        },
      ],
    };
    const result = await new LocalWorkflowExecutor(
      new PlaywrightBrowserSessionFactory(),
    ).execute({ ...context.request, workflow });

    expect(result.status).toBe('failed');
    expect(result.counts.attempted).toBe(2);
    expect(result.failedStepId).toBe('failure');
    expect(result.steps[1]?.error?.code, JSON.stringify(result)).toBe(code);
    expect(context.server.completed()).toBe(false);
  });

  it('closes Chromium after the total run timeout', async () => {
    const context = await fixture();
    const navigate = context.request.workflow.steps[0];
    if (navigate === undefined) {
      throw new Error('Fixture must contain a navigate step.');
    }
    const workflow: WorkflowDefinition = {
      ...context.request.workflow,
      steps: [
        navigate,
        {
          id: 'longWait',
          type: 'wait',
          name: 'Long wait',
          durationMs: 5_000,
        },
        {
          id: 'later',
          type: 'click',
          name: 'Later',
          locator: { kind: 'testId', value: 'open-form' },
        },
      ],
    };
    const result = await new LocalWorkflowExecutor(
      new PlaywrightBrowserSessionFactory(),
    ).execute({
      ...context.request,
      workflow,
      options: {
        ...context.request.options,
        totalTimeoutMs: 200,
      },
    });

    expect(result.status).toBe('timed_out');
    expect(result.terminationCause).toBe('total_timeout');
    expect(result.steps.map((step) => step.status)).toEqual([
      'succeeded',
      'timed_out',
      'skipped',
    ]);
  });

  it('closes Chromium after cancellation during a wait', async () => {
    const context = await fixture();
    const navigate = context.request.workflow.steps[0];
    if (navigate === undefined) {
      throw new Error('Fixture must contain a navigate step.');
    }
    const workflow: WorkflowDefinition = {
      ...context.request.workflow,
      steps: [
        navigate,
        {
          id: 'longWait',
          type: 'wait',
          name: 'Long wait',
          durationMs: 5_000,
        },
        {
          id: 'later',
          type: 'click',
          name: 'Later',
          locator: { kind: 'testId', value: 'open-form' },
        },
      ],
    };
    const controller = new AbortController();
    const cancellation = setTimeout(() => controller.abort(), 200);
    try {
      const result = await new LocalWorkflowExecutor(
        new PlaywrightBrowserSessionFactory(),
      ).execute({ ...context.request, workflow }, controller.signal);
      expect(result.status).toBe('cancelled');
      expect(result.terminationCause).toBe('run_cancelled');
      expect(result.steps.map((step) => step.status)).toEqual([
        'succeeded',
        'cancelled',
        'skipped',
      ]);
    } finally {
      clearTimeout(cancellation);
    }
  });

  it('fails an incorrect text verification and skips later browser steps', async () => {
    const context = await fixture();
    const privateExpected = 'Incorrect private expectation';
    const workflow: WorkflowDefinition = {
      ...context.request.workflow,
      steps: context.request.workflow.steps.map((candidate) =>
        candidate.id === 'verifySuccessText' && candidate.type === 'verify'
          ? {
              ...candidate,
              timeoutMs: 200,
              assertion: {
                kind: 'text',
                locator: { kind: 'testId', value: 'final-result' },
                matchMode: 'exact',
                expected: { kind: 'literal', value: privateExpected },
              },
            }
          : candidate,
      ),
    };
    const result = await new LocalWorkflowExecutor(
      new PlaywrightBrowserSessionFactory(),
    ).execute({ ...context.request, workflow });

    expect(result.status).toBe('failed');
    expect(result.failedStepId).toBe('verifySuccessText');
    expect(
      result.steps.find((step) => step.stepId === 'verifySuccessText')?.error
        ?.code,
    ).toBe('VERIFICATION_NOT_MATCHED');
    expect(
      result.steps
        .slice(
          result.steps.findIndex(
            (step) => step.stepId === 'verifySuccessText',
          ) + 1,
        )
        .every((step) => step.status === 'skipped'),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain(privateExpected);
    expect(JSON.stringify(result)).not.toContain('Fixture completed');
  });

  it('cancels bounded verification polling and closes Chromium', async () => {
    const context = await fixture();
    const navigate = context.request.workflow.steps[0];
    if (navigate?.type !== 'navigate') {
      throw new Error('Fixture must start with Navigate.');
    }
    const workflow: WorkflowDefinition = {
      ...context.request.workflow,
      steps: [
        navigate,
        {
          id: 'longVerification',
          type: 'verify',
          name: 'Wait for absent outcome',
          assertion: {
            kind: 'visible',
            locator: { kind: 'testId', value: 'never-visible' },
          },
          timeoutMs: 5_000,
        },
      ],
    };
    const controller = new AbortController();
    const cancellation = setTimeout(() => controller.abort(), 200);
    try {
      const result = await new LocalWorkflowExecutor(
        new PlaywrightBrowserSessionFactory(),
      ).execute({ ...context.request, workflow }, controller.signal);
      expect(result.status).toBe('cancelled');
      expect(result.steps[1]?.status).toBe('cancelled');
      expect(JSON.stringify(result)).not.toContain('never-visible');
    } finally {
      clearTimeout(cancellation);
    }
  });
});
