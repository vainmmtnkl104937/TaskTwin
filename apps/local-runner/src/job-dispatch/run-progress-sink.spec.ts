import type { WorkflowProgressBatch } from '@tasktwin/run-protocol';
import { describe, expect, it, vi } from 'vitest';

import { RunProgressSink } from './run-progress-sink.js';

const event = {
  executionId: '1da7ae80-5682-4e7a-adce-a2d99c6d04e8',
  timestamp: '2026-07-31T00:00:00.000Z',
  kind: 'run_status_changed' as const,
  status: 'pending' as const,
};

describe('RunProgressSink', () => {
  it('assigns monotonic sequences and keeps an exact batch across retry', async () => {
    const received: WorkflowProgressBatch[] = [];
    const send = vi.fn(async (batch: WorkflowProgressBatch) => {
      received.push(batch);
      if (received.length === 1) {
        throw new Error('transient');
      }
      return {
        acceptedThroughSequence: batch.lastSequence,
        cancelRequested: false,
      };
    });
    const sink = new RunProgressSink(send, vi.fn());
    sink.emit(event);
    sink.emit({ ...event, status: 'validating' });
    await sink.flush();

    expect(received[0]).toEqual(received[1]);
    expect(received.at(-1)?.lastSequence).toBe(2);
    expect(received.at(-1)?.events[0]?.event).not.toHaveProperty('value');
  });

  it('requests cancellation from a progress acknowledgement', async () => {
    const abort = vi.fn();
    const sink = new RunProgressSink(
      async (batch) => ({
        acceptedThroughSequence: batch.lastSequence,
        cancelRequested: true,
      }),
      abort,
    );
    sink.emit(event);
    await sink.flush();
    expect(abort).toHaveBeenCalledOnce();
  });
});
