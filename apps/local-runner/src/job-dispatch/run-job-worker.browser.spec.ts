import { createHash, randomUUID } from 'node:crypto';

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
import {
  DEFAULT_WORKSPACE_EXECUTION_POLICY,
  canonicalPolicyJson,
  evaluateWorkflowPolicy,
  serializeCanonicalJson,
} from '@tasktwin/workflow-policy';
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
        id: 'approve-submit',
        type: 'approval',
        name: 'Approve submit',
        message: 'Approve the fixture submission.',
        riskLevel: 'medium',
        scope: 'next_step',
        timeoutMs: 10_000,
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
  it('waits for approval, then executes the gated browser action exactly once', async () => {
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
    let approvalCreateCount = 0;
    let approvalPollCount = 0;
    const approvalRequestId = randomUUID();
    const approvalRequestedAt = new Date().toISOString();
    const approvalExpiresAt = new Date(Date.now() + 10_000).toISOString();
    const claimedWorkflow = workflow(server.origin);
    const definitionDigest = createHash('sha256')
      .update(
        serializeCanonicalJson(
          JSON.parse(JSON.stringify(claimedWorkflow)) as Parameters<
            typeof serializeCanonicalJson
          >[0],
        ),
      )
      .digest('hex');
    const policyDigest = createHash('sha256')
      .update(canonicalPolicyJson(DEFAULT_WORKSPACE_EXECUTION_POLICY))
      .digest('hex');
    const policyEvaluation = evaluateWorkflowPolicy({
      policy: DEFAULT_WORKSPACE_EXECUTION_POLICY,
      workflow: claimedWorkflow,
      policyDigest,
      workflowDigest: definitionDigest,
    });

    const transport: RunnerJobTransport = {
      claimJob: async () => {
        claimCount += 1;
        return RunnerJobClaimResponseSchema.parse({
          schemaVersion: 1,
          status: 'claimed',
          job: {
            runId,
            runProtocolVersion: 2,
            workflowSchemaVersion: 1,
            definitionDigest,
            workflow: claimedWorkflow,
            policy: {
              versionId: randomUUID(),
              revision: 1,
              digest: policyDigest,
              definition: DEFAULT_WORKSPACE_EXECUTION_POLICY,
              evaluation: policyEvaluation,
            },
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
      createApprovalRequest: async () => {
        approvalCreateCount += 1;
        return {
          approvalRequestId,
          status: 'PENDING',
          requestedAt: approvalRequestedAt,
          expiresAt: approvalExpiresAt,
          pollAfterSeconds: 1,
          idempotent: false,
        };
      },
      getApprovalStatus: async () => {
        approvalPollCount += 1;
        return {
          status: 'APPROVED',
          requestedAt: approvalRequestedAt,
          expiresAt: approvalExpiresAt,
          resolvedAt: new Date().toISOString(),
          pollAfterSeconds: 1,
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
    expect(approvalCreateCount).toBe(1);
    expect(approvalPollCount).toBe(1);
    expect(completion?.result.status, JSON.stringify(completion?.result)).toBe(
      'succeeded',
    );
    expect(server.completed()).toBe(true);
    expect(
      progress.some((batch) =>
        batch.events.some(
          ({ event }) =>
            event.kind === 'run_status_changed' &&
            event.status === 'waiting_for_approval',
        ),
      ),
    ).toBe(true);
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
