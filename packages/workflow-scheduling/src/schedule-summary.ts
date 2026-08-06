import { DateTime } from 'luxon';

import type {
  ScheduleDefinition,
  PersistedScheduleDefinition,
} from './definitions.js';
import type { WorkflowScheduleStatus } from './schedule-status.js';

/**
 * A safe, human-readable schedule summary suitable for display in the Web UI
 * and for audit records.
 *
 * Contains no secrets, no sensitive credentials, and no workflow internals.
 */
export interface SafeScheduleSummary {
  /** Human-readable name chosen by the user. */
  readonly name: string;
  /** Machine-readable type. */
  readonly type: ScheduleDefinition['type'];
  /** The validated IANA timezone name. */
  readonly timezone: string;
  /** The local time as HH:MM in the schedule's timezone. */
  readonly localTime: string;
  /** Short human-readable recurrence description. */
  readonly recurrenceDescription: string;
  /** ISO timestamp of the next firing, or null if none are known. */
  readonly nextOccurrenceAt: string | null;
  /** ISO timestamp of the last firing, or null if none have occurred yet. */
  readonly lastOccurrenceAt: string | null;
  /** Current schedule status. */
  readonly status: WorkflowScheduleStatus;
  /** Reason for auto-pause, if applicable. */
  readonly autoPauseReason?: string;
  /** If true, the schedule will not fire again. */
  readonly isComplete: boolean;
  /** If true, the schedule was manually archived. */
  readonly isArchived: boolean;
  /** True if the schedule can be manually paused/resumed. */
  readonly isControllable: boolean;
  /** True if the schedule can be resumed. */
  readonly canResume: boolean;
  /** Number of occurrences processed (approximate, from audit). */
  readonly occurrenceCount?: number;
}

function localTimeFromDefinition(def: ScheduleDefinition): string {
  return def.time;
}

function recurrenceDescription(def: ScheduleDefinition): string {
  switch (def.type) {
    case 'one_time': {
      const dt = DateTime.fromISO(def.date, { zone: def.timezone }).set({
        hour: parseInt(def.time.split(':')[0]!, 10),
        minute: parseInt(def.time.split(':')[1]!, 10),
      });
      return `Once on ${dt.toLocaleString(DateTime.DATE_FULL)}`;
    }
    case 'daily': {
      if (def.intervalDays === 1) {
        return `Daily at ${def.time}`;
      }
      return `Every ${def.intervalDays} days at ${def.time}`;
    }
    case 'weekly': {
      const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const days = def.weekdays.map((d) => weekdayNames[d - 1]).join(', ');
      if (def.intervalWeeks === 1) {
        return `Weekly on ${days} at ${def.time}`;
      }
      return `Every ${def.intervalWeeks} weeks on ${days} at ${def.time}`;
    }
  }
}

function formatTimestamp(ts: Date | string | null): string | null {
  if (ts === null) return null;
  const d = typeof ts === 'string' ? new Date(ts) : ts;
  return d.toISOString();
}

function isControllable(status: WorkflowScheduleStatus): boolean {
  return status === 'ACTIVE' || status === 'PAUSED' || status === 'AUTO_PAUSED';
}

function canResume(status: WorkflowScheduleStatus): boolean {
  return status === 'PAUSED' || status === 'AUTO_PAUSED';
}

export function buildSafeScheduleSummary(
  name: string,
  definition: PersistedScheduleDefinition,
  status: WorkflowScheduleStatus,
  nextOccurrenceAt: Date | string | null,
  lastOccurrenceAt: Date | string | null,
  autoPauseReason?: string,
): SafeScheduleSummary {
  return {
    name,
    type: definition.type,
    timezone: definition.timezone,
    localTime: localTimeFromDefinition(definition),
    recurrenceDescription: recurrenceDescription(definition),
    nextOccurrenceAt: formatTimestamp(nextOccurrenceAt),
    lastOccurrenceAt: formatTimestamp(lastOccurrenceAt),
    status,
    ...(autoPauseReason !== undefined
      ? { autoPauseReason }
      : {}),
    isComplete: status === 'COMPLETED',
    isArchived: status === 'ARCHIVED',
    isControllable: isControllable(status),
    canResume: canResume(status),
  };
}
