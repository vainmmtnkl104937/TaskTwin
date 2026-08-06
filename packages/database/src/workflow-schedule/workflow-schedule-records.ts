import type { OrganizationRole } from '../generated/prisma/client.js';

export interface WorkflowScheduleRecord {
  id: string;
  workspaceId: string;
  workflowId: string;
  workflowVersionId: string;
  workflowVersion: number;
  runnerDeviceId: string;
  createdByUserId: string;
  clientScheduleId: string;
  name: string;
  definition: unknown;
  definitionDigest: string;
  workflowDigest: string;
  status: 'ACTIVE' | 'PAUSED' | 'AUTO_PAUSED' | 'COMPLETED' | 'ARCHIVED';
  overlapPolicy: string;
  misfirePolicy: string;
  maxStartDelaySeconds: number;
  nextOccurrenceAt: Date | null;
  lastOccurrenceAt: Date | null;
  autoPauseReason: string | null;
  autoPausedAt: Date | null;
  autoPausedByOccurrenceId: string | null;
  completedAt: Date | null;
  archivedAt: Date | null;
  archivedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowScheduleOccurrenceRecord {
  id: string;
  scheduleId: string;
  workflowRunId: string | null;
  scheduledFor: Date;
  startDeadlineAt: Date;
  status: 'PENDING' | 'DISPATCHED' | 'SUCCEEDED' | 'SKIPPED' | 'TIMED_OUT' | 'CANCELLED';
  skipReason: string | null;
  skippedAt: Date | null;
  dispatchedAt: Date | null;
  completedAt: Date | null;
  terminationCause: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowScheduleAccess {
  workspaceId: string;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
}

export interface ScheduleCreationResult {
  schedule: WorkflowScheduleRecord;
  nextOccurrenceAt: Date | null;
  idempotent: boolean;
  ready: boolean;
  readinessIssues: unknown[];
}

export interface OccurrenceDispatchResult {
  occurrence: WorkflowScheduleOccurrenceRecord;
  workflowRunId: string | null;
  idempotent: boolean;
  skipReason?: string;
  autoPaused?: boolean;
  autoPauseReason?: string;
}
