import { randomUUID } from 'node:crypto';

import {
  RunnerJobClaimResponseSchema,
  type WorkflowProgressBatch,
  type WorkflowRunCompletionRequest,
} from '@tasktwin/run-protocol';
import {
  StoredRunnerCredentialSchema,
  type StoredRunnerCredential,
} from '@tasktwin/runner-protocol';
import type { WorkflowDefinition } from '@tasktwin/workflow-schema';
import { afterEach, describe, expect, it } from 'vitest';

import type { RunnerJobTransport } from '../control-plane-client.js';
import {
  startFixtureServer,
  type RunningFixtureServer,
} from '../execution/fixture-server.js';
import { PlaywrightBrowserSessionFactory } from '../execution/playwright-browser-session.js';
import { systemClock } from '../runner-service.js';
import { RunJobWorker } from './run-job-worker.js';

const servers: RunningFixtureServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function workflow(origin: string): WorkflowDefinition {
  return {
    schemaVersion: 1,
    workflowId: 'session17BrowserDispatch',
    version: 1,
    name: 'Session 17 browser dispatch',
    status: 'published',
    variables: [],
    steps: [
      {
        id: 'navigate',
        type: 'navigate',
        name: 'Navigate',
        url: { kind: 'literal', value: `${origin}/?not-reported=true` },
      },
      {
        id: 'open',
        type: 'click',
        name: 'Open form',
        locator: { kind: 'testId', value: 'open-form' },
      },
      {
        id: 'fill',
        type: 'fill',
        name: 'Fill customer name',
        locator: { kind: 'label', value: 'Customer name', exact: true },
        value: { kind: 'literal', value: 'TaskTwin sample' },
      },
      {
        id: 'select',
        type: 'select',
        name: 'Select option',
        locator: { kind: 'label', value: 'Required option', exact: true },
        value: { kind: 'literal', value: 'second' },
      },
      {
        id: 'check',
        type: 'setChecked',
        name: 'Confirm fixture',
        locator: { kind: 'label', value: 'Confirm fixture', exact: true },
        checked: true,
      },
      {
        id: 'submit',
        type: 'click',
        name: 'Submit fixture',
        locator: {
          kind: 'role',
          role: 'button',
          name: 'Submit fixture',
          exact: true,
        },
      },
      {
        id: 'wait',
        type: 'wait',
        name: 'Allow completion',
        durationMs: 100,
      },
    ],
  };
}

describe('persisted job Chromium dispatch', () => {
  it('claims one job, streams safe ordered progress and completes it', async () => {
    const server = await startFixtureServer();
    servers.push(server);
    const runId = randomUUID();
    const runnerDeviceId = randomUUID();
    const leaseToken = 'session17_browser_lease_token_value_000000000';
    const runnerCredential = 'r'.repeat(43);
    const credential = StoredRunnerCredentialSchema.parse({
      schemaVersion: 1,
      controlPlaneOrigin: 'http://127.0.0.1:3001',
      runnerDeviceId,
      workspaceId: randomUUID(),
      installationId: randomUUID(),
      credential: runnerCredential,
      savedAt: new Date().toISOString(),
    });
    const controller = new AbortController();
    const progress: WorkflowProgressBatch[] = [];
    let completion: WorkflowRunCompletionRequest | undefined;
    let claimCount = 0;

    const transport: RunnerJobTransport = {
      claimJob: async () => {
        claimCount += 1;
        return RunnerJobClaimResponseSchema.parse({
          schemaVersion: 1,
          status: 'claimed',
          job: {
            runId,
            definitionDigest: 'a'.repeat(64),
            workflow: workflow(server.origin),
            runtimeInput: { kind: 'none' },
            allowedOrigins: [server.origin],
            options: { totalTimeoutMs: 30_000, stepTimeoutMs: 10_000 },
            leaseToken,
            leaseExpiresAt: new Date(Date.now() + 30_000).toISOString(),
            renewAfterSeconds: 10,
          },
        });
      },
      renewJobLease: async () => ({
        schemaVersion: 1,
        leaseExpiresAt: new Date(Date.now() + 30_000).toISOString(),
        renewAfterSeconds: 10,
        cancelRequested: false,
      }),
      sendProgress: async (
        _storedCredential: StoredRunnerCredential,
        _runId: string,
        _leaseToken: string,
        batch: WorkflowProgressBatch,
      ) => {
        progress.push(batch);
        return {
          acceptedThroughSequence: batch.lastSequence,
          cancelRequested: false,
        };
      },
      completeJob: async (
        _storedCredential: StoredRunnerCredential,
        _runId: string,
        _leaseToken: string,
        request: WorkflowRunCompletionRequest,
      ) => {
        completion = request;
        controller.abort();
        return {} as never;
      },
    };
    const output: string[] = [];

    await new RunJobWorker(
      transport,
      new PlaywrightBrowserSessionFactory(),
      systemClock,
      { write: (message) => output.push(message) },
      '0.1.0',
    ).runLoop(credential, controller.signal);

    expect(claimCount).toBe(1);
    expect(completion?.result.status, JSON.stringify(completion?.result)).toBe(
      'succeeded',
    );
    expect(server.completed()).toBe(true);
    expect(
      progress.flatMap((batch) => batch.events.map((event) => event.sequence)),
    ).toEqual(progress.map((_, index) => index + 1));
    const safeOutput = JSON.stringify({ output, progress, completion });
    expect(safeOutput).not.toContain('TaskTwin sample');
    expect(safeOutput).not.toContain('not-reported=true');
    expect(safeOutput).not.toContain(leaseToken);
    expect(safeOutput).not.toContain(runnerCredential);
  });
});
