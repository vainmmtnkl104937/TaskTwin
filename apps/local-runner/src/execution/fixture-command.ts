import { readFile } from 'node:fs/promises';

import { WorkflowRunInputSubmissionSchema } from '@tasktwin/workflow-inputs';
import { WorkflowDefinitionSchema } from '@tasktwin/workflow-schema';
import type { WorkflowExecutionResult } from '@tasktwin/workflow-engine';

import type { RunnerOutput } from '../runner-service.js';
import { CliProgressSink } from './cli-progress-sink.js';
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

export function executionExitCode(
  result: WorkflowExecutionResult,
  fixtureCompleted: boolean,
): number {
  if (result.status === 'cancelled') {
    return 2;
  }
  if (result.status === 'timed_out') {
    return 3;
  }
  return result.status === 'succeeded' && fixtureCompleted ? 0 : 1;
}

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
  waitDurationMs?: number,
  totalTimeoutMs = 120_000,
): Promise<number> {
  const server = await startFixtureServer();
  try {
    const storedWorkflow = WorkflowDefinitionSchema.parse(
      await readBoundedJson(WORKFLOW_FILE),
    );
    const workflow = WorkflowDefinitionSchema.parse({
      ...storedWorkflow,
      steps: storedWorkflow.steps.map((step) =>
        waitDurationMs !== undefined && step.id === 'boundedWait'
          ? { ...step, durationMs: waitDurationMs }
          : step,
      ),
    });
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
      new CliProgressSink(output),
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
          totalTimeoutMs,
          stepTimeoutMs: 30_000,
        },
      },
      signal,
    );
    output.write(JSON.stringify(result, null, 2));
    return executionExitCode(result, server.completed());
  } finally {
    await server.close();
  }
}
