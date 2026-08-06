// ---------------------------------------------------------------------------
// Schema types
// ---------------------------------------------------------------------------
export {
  WorkflowScheduleStatusSchema,
  WorkflowScheduleOccurrenceStatusSchema,
  ScheduleSkipReasonSchema,
  ScheduleAutoPauseReasonSchema,
  type WorkflowScheduleStatus,
  type WorkflowScheduleOccurrenceStatus,
  type ScheduleSkipReason,
  type ScheduleAutoPauseReason,
} from './schedule-status.js';

export {
  IanaTimezoneSchema,
  LocalDateSchema,
  LocalTimeSchema,
  WeekdaySchema,
  OneTimeScheduleDefinitionSchema,
  DailyScheduleDefinitionSchema,
  WeeklyScheduleDefinitionSchema,
  ScheduleDefinitionSchema,
  type OneTimeScheduleDefinition,
  type DailyScheduleDefinition,
  type WeeklyScheduleDefinition,
  type ScheduleDefinition,
  type PersistedScheduleDefinition,
  type IanaTimezone,
  type Weekday,
} from './definitions.js';

export { SCHEDULING_ERROR_CODES, type SchedulingErrorCode } from './scheduling-errors.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export {
  WORKFLOW_SCHEDULING_SCHEMA_VERSION,
  DEFAULT_MAX_START_DELAY_SECONDS,
  MAX_MAX_START_DELAY_SECONDS,
  MIN_MAX_START_DELAY_SECONDS,
  OVERLAP_POLICY_VALUES,
  MISFIRE_POLICY_VALUES,
  COMMON_TIMEZONES,
} from './constants.js';

// ---------------------------------------------------------------------------
// Timezone & DST
// ---------------------------------------------------------------------------
export {
  isValidIanaTimezone,
  validateIanaTimezone,
  localDateTimeToUtc,
  isLocalDateTimeValid,
  parseLocalDateTimeToUtc,
  type DstOutcome,
} from './timezone.js';

// ---------------------------------------------------------------------------
// Recurrence helpers
// ---------------------------------------------------------------------------
export {
  validateWeekdays,
  areWeekdaysValid,
  parseLocalDate,
  parseLocalTime,
  daysBetween,
  isValidIntervalDays,
  isValidIntervalWeeks,
} from './recurrence.js';

// ---------------------------------------------------------------------------
// Occurrence calculation
// ---------------------------------------------------------------------------
export {
  nextOneTimeOccurrence,
  nextDailyOccurrence,
  nextWeeklyOccurrence,
  nextOccurrence,
  nextNOccurrences,
  type OccurrenceResult,
  type SkippedOccurrence,
} from './occurrence-calculation.js';

// ---------------------------------------------------------------------------
// Occurrence identity
// ---------------------------------------------------------------------------
export { buildOccurrenceKey, occurrenceKeysMatch } from './occurrence-key.js';

// ---------------------------------------------------------------------------
// Unattended readiness
// ---------------------------------------------------------------------------
export {
  analyzeUnattendedReadiness,
  analyzeScheduleCreationReadiness,
  evaluateSchedulePolicy,
  type UnattendedReadinessInput,
  type ScheduleCreationReadinessInput,
  type ScheduleReadinessReport,
  type ScheduleReadinessIssue,
  type ScheduleReadinessIssueCode,
} from './unattended-readiness.js';

// ---------------------------------------------------------------------------
// Safe summaries
// ---------------------------------------------------------------------------
export { buildSafeScheduleSummary, type SafeScheduleSummary } from './schedule-summary.js';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export { SchedulingError } from './scheduling-errors.js';
