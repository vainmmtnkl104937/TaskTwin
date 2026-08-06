/**
 * Stable error codes used by the workflow-scheduling package.
 * These are used both in domain logic and can be surfaced to callers.
 */
export const SCHEDULING_ERROR_CODES = [
  // Definition validation
  'SCHEDULE_INVALID_TIMEZONE',
  'SCHEDULE_INVALID_LOCAL_TIME',
  'SCHEDULE_INVALID_LOCAL_DATE',
  'SCHEDULE_DUPLICATE_WEEKDAYS',
  'SCHEDULE_END_BEFORE_START',
  'SCHEDULE_INTERVAL_OUT_OF_RANGE',
  'SCHEDULE_PAST_DATE',
  'SCHEDULE_WEEKDAY_OUT_OF_RANGE',
  // Readiness
  'UNATTENDED_NOT_SUPPORTED',
  'WORKFLOW_VERSION_NOT_PUBLISHED',
  'WORKFLOW_DEFINITION_INVALID',
  'RUNTIME_INPUT_REQUIRED',
  'SECRET_REQUIRED',
  'FILE_INPUT_REQUIRED',
  'APPROVAL_STEP_FORBIDDEN',
  'MANUAL_REPAIR_FORBIDDEN',
  'LOCATOR_REPAIR_FORBIDDEN',
  'RECOVERY_MODE_UNSUPPORTED',
  'RUNNER_CAPABILITY_UNAVAILABLE',
  'RUNNER_NOT_IN_WORKSPACE',
  'RUNNER_REVOKED',
  'POLICY_DENIED',
  'POLICY_REQUIRES_APPROVAL',
  // Occurrence
  'OCCURRENCE_IN_PAST',
  'OCCURRENCE_INVALID',
  'OCCURRENCE_MISSED',
  // Policy
  'POLICY_CHECK_FAILED',
  'POLICY_UNAVAILABLE',
  'WORKFLOW_VERSION_UNAVAILABLE',
] as const;

export type SchedulingErrorCode =
  (typeof SCHEDULING_ERROR_CODES)[number];

/**
 * Represents a structured scheduling error.
 * This class is used throughout the domain logic to represent recoverable
 * and fatal scheduling errors.
 */
export class SchedulingError extends Error {
  constructor(
    public readonly code: SchedulingErrorCode,
    public override readonly message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'SchedulingError';
  }

  toJSON(): object {
    return {
      code: this.code,
      message: this.message,
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}
