'use client';

import type {
  WorkflowScheduleStatus,
  WorkflowScheduleOccurrenceStatus,
} from '@/lib/control-plane-contracts';

const SCHEDULE_STATUS_LABELS: Record<WorkflowScheduleStatus, string> = {
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  AUTO_PAUSED: 'Auto-paused',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
};

export function ScheduleStatusBadge({ status }: { status: WorkflowScheduleStatus }) {
  return (
    <span className={`status-badge schedule-status-${status.toLowerCase()}`}>
      {SCHEDULE_STATUS_LABELS[status]}
    </span>
  );
}

const OCCURRENCE_STATUS_LABELS: Record<WorkflowScheduleOccurrenceStatus, string> = {
  PENDING: 'Pending',
  DISPATCHED: 'Dispatched',
  SUCCEEDED: 'Succeeded',
  SKIPPED: 'Skipped',
  TIMED_OUT: 'Timed out',
  CANCELLED: 'Cancelled',
};

export function OccurrenceStatusBadge({
  status,
}: {
  status: WorkflowScheduleOccurrenceStatus;
}) {
  return (
    <span className={`status-badge occurrence-status-${status.toLowerCase()}`}>
      {OCCURRENCE_STATUS_LABELS[status]}
    </span>
  );
}
