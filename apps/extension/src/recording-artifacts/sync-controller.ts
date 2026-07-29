import type { RecordingArtifact } from '@tasktwin/recording-schema';

import type { RecordingArtifactArchive } from './archive-store.js';
import {
  RecordingTransportResultSchema,
  type RecordingOutboxEntry,
  type RecordingTransportResult,
} from './contracts.js';

export interface RecordingSyncTransport {
  send(artifact: RecordingArtifact): Promise<unknown>;
}

export interface RecordingSyncClock {
  now(): string;
}

export class RecordingSyncController {
  constructor(
    private readonly archive: RecordingArtifactArchive,
    private readonly transport: RecordingSyncTransport,
    private readonly clock: RecordingSyncClock,
  ) {}

  async sync(clientSessionId: string): Promise<RecordingOutboxEntry> {
    const syncing = await this.archive.beginSync(
      clientSessionId,
      this.clock.now(),
    );
    if (syncing.entry.status === 'synced') {
      return syncing.entry;
    }

    let result: RecordingTransportResult;
    try {
      const response = await this.transport.send(syncing.artifact);
      const parsed = RecordingTransportResultSchema.safeParse(response);
      result = parsed.success
        ? parsed.data
        : {
            success: false,
            errorCode: 'INVALID_TRANSPORT_RESPONSE',
          };
    } catch {
      result = {
        success: false,
        errorCode: 'TRANSPORT_UNAVAILABLE',
      };
    }

    return result.success
      ? this.archive.markSynced(
          clientSessionId,
          result.remoteSessionId,
          this.clock.now(),
        )
      : this.archive.markFailed(
          clientSessionId,
          result.errorCode,
          this.clock.now(),
        );
  }
}
