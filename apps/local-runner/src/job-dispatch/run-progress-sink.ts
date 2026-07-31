import { randomUUID } from 'node:crypto';

import {
  WorkflowProgressBatchSchema,
  type WorkflowProgressBatch,
} from '@tasktwin/run-protocol';
import type {
  WorkflowProgressEvent,
  WorkflowProgressSink,
} from '@tasktwin/workflow-engine';

const MAX_BUFFERED_EVENTS = 2_000;
const RETRY_ATTEMPTS = 3;

export class RunProgressSink implements WorkflowProgressSink {
  private sequence = 0;
  private pendingCount = 0;
  private chain: Promise<void> = Promise.resolve();
  private failure: unknown;

  constructor(
    private readonly send: (batch: WorkflowProgressBatch) => Promise<{
      acceptedThroughSequence: number;
      cancelRequested: boolean;
    }>,
    private readonly abort: () => void,
  ) {}

  emit(event: WorkflowProgressEvent): void {
    if (
      this.failure !== undefined ||
      this.pendingCount >= MAX_BUFFERED_EVENTS
    ) {
      this.abort();
      throw new Error('Progress delivery stopped safely.');
    }
    this.sequence += 1;
    this.pendingCount += 1;
    const batch = WorkflowProgressBatchSchema.parse({
      schemaVersion: 1,
      clientBatchId: randomUUID(),
      firstSequence: this.sequence,
      lastSequence: this.sequence,
      events: [{ sequence: this.sequence, event }],
    });
    this.chain = this.chain
      .then(async () => {
        const response = await this.sendWithRetry(batch);
        if (response.acceptedThroughSequence !== batch.lastSequence) {
          throw new Error('Progress acknowledgement is invalid.');
        }
        if (response.cancelRequested) {
          this.abort();
        }
        this.pendingCount -= 1;
      })
      .catch((error: unknown) => {
        this.failure = error;
        this.abort();
      });
  }

  async flush(): Promise<void> {
    await this.chain;
    if (this.failure !== undefined) {
      throw new Error('Progress delivery failed safely.');
    }
  }

  private async sendWithRetry(batch: WorkflowProgressBatch) {
    let latestError: unknown;
    for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
      try {
        return await this.send(batch);
      } catch (error: unknown) {
        latestError = error;
      }
    }
    throw latestError;
  }
}
