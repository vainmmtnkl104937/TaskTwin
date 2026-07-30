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
      executionTimeoutMs: 30_000,
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
    expect(result.attemptedStepCount).toBe(
      context.request.workflow.steps.length,
    );
    expect(context.server.completed()).toBe(true);
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
    expect(result.attemptedStepCount).toBe(2);
    expect(result.failedStepId).toBe('failure');
    expect(result.steps[1]?.error?.code, JSON.stringify(result)).toBe(code);
    expect(context.server.completed()).toBe(false);
  });
});
