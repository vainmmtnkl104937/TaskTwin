import type {
  RecordingArtifact,
  RecordingPrivacySummary,
} from '@tasktwin/recording-schema';

import type {
  OrganizationRole,
  RecordingSessionStatus,
} from '../generated/prisma/client.js';

export interface OrganizationAccessRecord {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
}

export interface RecordingSessionMetadataRecord {
  id: string;
  clientSessionId: string;
  workspaceId: string;
  createdByUserId: string;
  status: RecordingSessionStatus;
  targetOrigin: string;
  startedAt: Date;
  stoppedAt: Date;
  eventCount: number;
  lastSequence: number;
  receivedEventCount: number;
  receivedLastSequence: number;
  privacySummary: RecordingPrivacySummary;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRecordingSessionResult {
  session: RecordingSessionMetadataRecord;
  idempotent: boolean;
}

export interface IngestRecordingBatchResult {
  recordingSessionId: string;
  clientBatchId: string;
  status: RecordingSessionStatus;
  acceptedEventCount: number;
  receivedEventCount: number;
  receivedLastSequence: number;
  idempotent: boolean;
}

export interface CompleteRecordingSessionResult {
  recordingSessionId: string;
  clientSessionId: string;
  status: 'completed';
  eventCount: number;
  lastSequence: number;
  idempotent: boolean;
}

export interface CompletedRecordingArtifactRecord {
  recordingSessionId: string;
  workspaceId: string;
  artifact: RecordingArtifact;
}
