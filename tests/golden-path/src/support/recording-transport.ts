import type { RecordingArtifact } from '@tasktwin/recording-schema';
import type { RecordingSyncTransport } from '../../../../apps/extension/src/recording-artifacts/sync-controller.js';

import { GoldenApiClient, object, stringField } from './api-client.js';

export class ApiRecordingSyncTransport implements RecordingSyncTransport {
  constructor(
    private readonly api: GoldenApiClient,
    private readonly workspaceId: string,
  ) {}

  async send(artifact: RecordingArtifact): Promise<unknown> {
    try {
      const created = object(
        await this.api.post(
          `/workspaces/${encodeURIComponent(this.workspaceId)}/recording-sessions`,
          {
            schemaVersion: artifact.schemaVersion,
            clientSessionId: artifact.clientSessionId,
            targetOrigin: artifact.targetOrigin,
            startedAt: artifact.startedAt,
            stoppedAt: artifact.stoppedAt,
            eventCount: artifact.eventCount,
            lastSequence: artifact.lastSequence,
            privacySummary: artifact.privacySummary,
          },
        ),
        'recording create response',
      );
      const remoteSessionId = stringField(created, 'recordingSessionId');
      if (artifact.events.length > 0) {
        await this.api.post(
          `/recording-sessions/${encodeURIComponent(remoteSessionId)}/batches`,
          {
            schemaVersion: 1,
            clientSessionId: artifact.clientSessionId,
            clientBatchId: crypto.randomUUID(),
            eventCount: artifact.eventCount,
            firstSequence: 1,
            lastSequence: artifact.lastSequence,
            events: artifact.events,
          },
        );
      }
      await this.api.post(
        `/recording-sessions/${encodeURIComponent(remoteSessionId)}/complete`,
        {
          schemaVersion: 1,
          clientSessionId: artifact.clientSessionId,
          eventCount: artifact.eventCount,
          lastSequence: artifact.lastSequence,
          privacySummary: artifact.privacySummary,
        },
      );
      return { success: true, remoteSessionId };
    } catch {
      return { success: false, errorCode: 'TRANSPORT_REJECTED' };
    }
  }
}
