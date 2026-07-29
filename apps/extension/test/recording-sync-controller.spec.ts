import { describe, expect, it, vi } from 'vitest';

import {
  ChromeLocalRecordingArchive,
  type LocalRecordingStorageArea,
} from '../src/recording-artifacts/archive-store.js';
import {
  RecordingSyncController,
  type RecordingSyncTransport,
} from '../src/recording-artifacts/sync-controller.js';
import {
  createRecordingArtifact,
  recordingSessionId,
  recordingTimestamp,
} from './recording-artifact-fixture.js';

class FakeLocalStorage implements LocalRecordingStorageArea {
  readonly values: Record<string, unknown> = {};

  get(key: string): Promise<Record<string, unknown>> {
    return Promise.resolve(
      key in this.values ? { [key]: structuredClone(this.values[key]) } : {},
    );
  }

  set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, structuredClone(items));
    return Promise.resolve();
  }
}

const remoteSessionId = '00000000-0000-4000-8000-000000000099';

async function setup(transport: RecordingSyncTransport) {
  const archive = new ChromeLocalRecordingArchive(new FakeLocalStorage());
  await archive.finalize(createRecordingArtifact(), recordingTimestamp);
  const controller = new RecordingSyncController(archive, transport, {
    now: () => recordingTimestamp,
  });
  return { archive, controller };
}

describe('recording sync orchestration', () => {
  it('marks a mock transport success as synced', async () => {
    const transport = {
      send: vi.fn().mockResolvedValue({
        success: true,
        remoteSessionId,
      }),
    } satisfies RecordingSyncTransport;
    const { controller, archive } = await setup(transport);

    const result = await controller.sync(recordingSessionId);

    expect(result).toMatchObject({
      status: 'synced',
      attemptCount: 1,
      remoteSessionId,
    });
    expect(transport.send).toHaveBeenCalledWith(createRecordingArtifact());
    await expect(archive.loadOutboxEntry(recordingSessionId)).resolves.toEqual(
      result,
    );
  });

  it('persists a safe failed state for a rejected mock attempt', async () => {
    const { controller } = await setup({
      send: () =>
        Promise.resolve({
          success: false,
          errorCode: 'TRANSPORT_REJECTED',
        }),
    });

    await expect(controller.sync(recordingSessionId)).resolves.toMatchObject({
      status: 'failed',
      attemptCount: 1,
      lastErrorCode: 'TRANSPORT_REJECTED',
      remoteSessionId: null,
    });
  });

  it('retries a failed mock attempt without duplicating the outbox entry', async () => {
    const transport = {
      send: vi.fn().mockResolvedValue({
        success: false,
        errorCode: 'TRANSPORT_REJECTED',
      }),
    } satisfies RecordingSyncTransport;
    const { controller, archive } = await setup(transport);
    await controller.sync(recordingSessionId);

    const retried = await controller.sync(recordingSessionId);

    expect(retried).toMatchObject({
      status: 'failed',
      attemptCount: 2,
      lastErrorCode: 'TRANSPORT_REJECTED',
    });
    expect(transport.send).toHaveBeenCalledTimes(2);
    await expect(archive.loadOutboxEntry(recordingSessionId)).resolves.toEqual(
      retried,
    );
  });

  it('maps thrown and malformed transport results to safe codes', async () => {
    const unavailable = await setup({
      send: () => Promise.reject(new Error('raw transport detail')),
    });
    await expect(
      unavailable.controller.sync(recordingSessionId),
    ).resolves.toMatchObject({
      status: 'failed',
      lastErrorCode: 'TRANSPORT_UNAVAILABLE',
    });

    const invalid = await setup({
      send: () => Promise.resolve({ accepted: true, rawBody: 'unsafe' }),
    });
    await expect(
      invalid.controller.sync(recordingSessionId),
    ).resolves.toMatchObject({
      status: 'failed',
      lastErrorCode: 'INVALID_TRANSPORT_RESPONSE',
    });
  });

  it('does not resend an already synced artifact', async () => {
    const transport = {
      send: vi.fn().mockResolvedValue({
        success: true,
        remoteSessionId,
      }),
    } satisfies RecordingSyncTransport;
    const { controller } = await setup(transport);
    await controller.sync(recordingSessionId);

    const second = await controller.sync(recordingSessionId);

    expect(second.status).toBe('synced');
    expect(transport.send).toHaveBeenCalledTimes(1);
  });
});
