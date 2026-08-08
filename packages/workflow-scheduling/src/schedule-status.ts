import { z } from 'zod';

/**
 * WorkflowSchedule status tracks the lifecycle of a schedule.
 *
 * ACTIVE       – dispatching occurrences on schedule
 * PAUSED       – manually paused by an OWNER or ADMIN
 * AUTO_PAUSED  – automatically paused due to ambiguous outcome or policy change
 * COMPLETED    – one-time schedule has fired its last occurrence
 * ARCHIVED     – manually archived; cannot be resumed
 */
export const WorkflowScheduleStatusSchema = z.enum([
  'ACTIVE',
  'PAUSED',
  'AUTO_PAUSED',
  'COMPLETED',
  'ARCHIVED',
]);

export type WorkflowScheduleStatus = z.infer<
  typeof WorkflowScheduleStatusSchema
>;

/**
 * WorkflowScheduleOccurrence status tracks a single scheduled instant.
 *
 * PENDING     – scheduler has created it but not yet dispatched a run
 * DISPATCHED  – a WorkflowRun has been created for this occurrence
 * SUCCEEDED   – the dispatched WorkflowRun succeeded
 * SKIPPED     – scheduler decided not to create a run (overlap, busy, policy, etc.)
 * TIMED_OUT   – the run was not claimed within the start window
 * CANCELLED   – the occurrence was cancelled (not used for scheduled skip)
 */
export const WorkflowScheduleOccurrenceStatusSchema = z.enum([
  'PENDING',
  'DISPATCHED',
  'SUCCEEDED',
  'SKIPPED',
  'TIMED_OUT',
  'CANCELLED',
]);

export type WorkflowScheduleOccurrenceStatus = z.infer<
  typeof WorkflowScheduleOccurrenceStatusSchema
>;

/**
 * Reasons recorded when an occurrence is skipped.
 */
export const ScheduleSkipReasonSchema = z.enum([
  /** No active WorkflowRun exists but the schedule is still processing its previous occurrence. */
  'schedule_overlap',
  /** The assigned Runner already has an active scheduled WorkflowRun. */
  'runner_busy',
  /** The assigned Runner is offline or revoked. */
  'runner_unavailable',
  /** The current Active Policy denies or requires approval for the workflow. */
  'policy_denied',
  /** The pinned WorkflowVersion is no longer published or available. */
  'source_version_unavailable',
  /** The scheduled instant plus the max-start-delay has already passed. */
  'missed_start_window',
  /** DST: the local time does not exist (clocks sprang forward). */
  'nonexistent_local_time',
  /** DST: the local time is ambiguous (clocks fell back); the earlier instant was skipped. */
  'repeated_local_time',
  'secret_readiness_failed',
  'secret_inventory_changed_before_execution',
]);

export type ScheduleSkipReason = z.infer<typeof ScheduleSkipReasonSchema>;

/**
 * Reasons recorded when a schedule is automatically paused.
 */
export const ScheduleAutoPauseReasonSchema = z.enum([
  /** The current Active Policy now denies or requires approval for the workflow. */
  'policy_review_required',
  /** The pinned WorkflowVersion is no longer published. */
  'source_version_unavailable',
  /**
   * The scheduled WorkflowRun ended with INTERRUPTED status or a
   * side-effect-unknown termination cause.
   */
  'ambiguous_outcome',
  'secret_readiness_failed',
]);

export type ScheduleAutoPauseReason = z.infer<
  typeof ScheduleAutoPauseReasonSchema
>;
