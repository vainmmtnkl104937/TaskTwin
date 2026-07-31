import { randomUUID } from 'node:crypto';

import {
  RunnerJobClaimRequestSchema,
  WorkflowRunCompletionRequestSchema,
  type ClaimedRunnerJob,
} from '@tasktwin/run-protocol';
import type { StoredRunnerCredential } from '@tasktwin/runner-protocol';

import type { RunnerJobTransport } from '../control-plane-client.js';
import type { BrowserSessionFactory } from '../execution/browser-session.js';
import { LocalWorkflowExecutor } from '../execution/workflow-executor.js';
import type { RunnerClock, RunnerOutput } from '../runner-service.js';
import { RunProgressSink } from './run-progress-sink.js';

export class RunJobWorker {
  constructor(
    private readonly transport: RunnerJobTransport,
    private readonly sessions: BrowserSessionFactory,
    private readonly clock: RunnerClock,
    private readonly output: RunnerOutput,
    private readonly runnerVersion: string,
  ) {}

  async runLoop(
    credential: StoredRunnerCredential,
    signal: AbortSignal,
  ): Promise<void> {
    while (!signal.aborted) {
      const claimRequest = RunnerJobClaimRequestSchema.parse({
        schemaVersion: 1,
        runProtocolVersion: 1,
        workflowEngineSchemaVersion: 1,
        runnerVersion: this.runnerVersion,
        claimAttemptId: randomUUID(),
      });
      const claim = await this.claimWithRetry(credential, claimRequest);
      if (claim.status === 'no_job') {
        await this.clock
          .sleep(claim.pollAfterSeconds * 1_000, signal)
          .catch(() => undefined);
        continue;
      }
      await this.executeClaimedJob(credential, claim.job, signal);
    }
  }

  private async claimWithRetry(
    credential: StoredRunnerCredential,
    request: ReturnType<typeof RunnerJobClaimRequestSchema.parse>,
  ) {
    let latestError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.transport.claimJob(credential, request);
      } catch (error: unknown) {
        latestError = error;
      }
    }
    throw latestError;
  }

  private async executeClaimedJob(
    credential: StoredRunnerCredential,
    job: ClaimedRunnerJob,
    shutdownSignal: AbortSignal,
  ): Promise<void> {
    const execution = new AbortController();
    const stopExecution = () => execution.abort();
    shutdownSignal.addEventListener('abort', stopExecution, { once: true });
    const leaseLoop = new AbortController();
    const sink = new RunProgressSink(
      (batch) =>
        this.transport.sendProgress(
          credential,
          job.runId,
          job.leaseToken,
          batch,
        ),
      stopExecution,
    );
    const renewal = this.renewUntilStopped(
      credential,
      job,
      execution,
      leaseLoop.signal,
    );
    try {
      this.output.write(`Workflow run ${job.runId} started.`);
      const result = await new LocalWorkflowExecutor(
        this.sessions,
        sink,
      ).execute(
        {
          schemaVersion: 1,
          workflow: job.workflow,
          inputs: job.inputs,
          allowedOrigins: job.allowedOrigins,
          options: {
            headless: true,
            actionTimeoutMs: Math.min(job.options.stepTimeoutMs, 30_000),
            navigationTimeoutMs: Math.min(job.options.stepTimeoutMs, 60_000),
            ...job.options,
          },
        },
        execution.signal,
        job.runId,
      );
      await sink.flush();
      const completion = WorkflowRunCompletionRequestSchema.parse({
        schemaVersion: 1,
        clientCompletionId: randomUUID(),
        result,
      });
      await this.completeWithRetry(credential, job, completion);
      this.output.write(
        `Workflow run ${job.runId} completed: ${result.status}.`,
      );
    } finally {
      leaseLoop.abort();
      await renewal;
      shutdownSignal.removeEventListener('abort', stopExecution);
    }
  }

  private async renewUntilStopped(
    credential: StoredRunnerCredential,
    job: ClaimedRunnerJob,
    execution: AbortController,
    signal: AbortSignal,
  ): Promise<void> {
    while (!signal.aborted) {
      await this.clock
        .sleep(job.renewAfterSeconds * 1_000, signal)
        .catch(() => undefined);
      if (signal.aborted) {
        return;
      }
      try {
        const response = await this.transport.renewJobLease(
          credential,
          job.runId,
          job.leaseToken,
        );
        if (response.cancelRequested) {
          execution.abort();
        }
      } catch {
        execution.abort();
        return;
      }
    }
  }

  private async completeWithRetry(
    credential: StoredRunnerCredential,
    job: ClaimedRunnerJob,
    completion: ReturnType<typeof WorkflowRunCompletionRequestSchema.parse>,
  ): Promise<void> {
    let latestError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.transport.completeJob(
          credential,
          job.runId,
          job.leaseToken,
          completion,
        );
        return;
      } catch (error: unknown) {
        latestError = error;
      }
    }
    throw latestError;
  }
}
