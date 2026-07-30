import { readFile } from 'node:fs/promises';

import { WorkflowRunInputSubmissionSchema } from '@tasktwin/workflow-inputs';
import { WorkflowDefinitionSchema } from '@tasktwin/workflow-schema';

import type { RunnerOutput } from '../runner-service.js';
import { PlaywrightBrowserSessionFactory } from './playwright-browser-session.js';
import { startFixtureServer } from './fixture-server.js';
import { LocalWorkflowExecutor } from './workflow-executor.js';

const MAX_FIXTURE_JSON_BYTES = 256 * 1024;
const WORKFLOW_FILE = new URL(
  '../../fixtures/execution/workflow.v1.json',
  import.meta.url,
);
const INPUTS_FILE = new URL(
  '../../fixtures/execution/runtime-inputs.v1.json',
  import.meta.url,
);

async function readBoundedJson(file: URL): Promise<unknown> {
  const text = await readFile(file, 'utf8');
  if (Buffer.byteLength(text, 'utf8') > MAX_FIXTURE_JSON_BYTES) {
    throw new Error('The Local Runner fixture JSON is too large.');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('The Local Runner fixture JSON is invalid.');
  }
}

export async function executeFixtureCommand(
  output: RunnerOutput,
  headed: boolean,
  signal?: AbortSignal,
): Promise<void> {
  const server = await startFixtureServer();
  try {
    const workflow = WorkflowDefinitionSchema.parse(
      await readBoundedJson(WORKFLOW_FILE),
    );
    const storedInputs = WorkflowRunInputSubmissionSchema.parse(
      await readBoundedJson(INPUTS_FILE),
    );
    const inputs = WorkflowRunInputSubmissionSchema.parse({
      ...storedInputs,
      values: {
        ...storedInputs.values,
        fixtureUrl: { kind: 'string', value: `${server.origin}/` },
      },
    });
    const executor = new LocalWorkflowExecutor(
      new PlaywrightBrowserSessionFactory(),
    );
    const result = await executor.execute(
      {
        schemaVersion: 1,
        workflow,
        inputs,
        allowedOrigins: [server.origin],
        options: {
          headless: !headed,
          actionTimeoutMs: 10_000,
          navigationTimeoutMs: 30_000,
          executionTimeoutMs: 120_000,
        },
      },
      signal,
    );
    if (result.status !== 'succeeded' || !server.completed()) {
      throw new Error('The Local Runner fixture execution failed safely.');
    }
    output.write(JSON.stringify(result, null, 2));
  } finally {
    await server.close();
  }
}
