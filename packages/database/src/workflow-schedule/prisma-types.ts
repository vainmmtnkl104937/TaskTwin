// Local Prisma type extensions for WorkflowSchedule models
// These types should match the schema.prisma definitions
// The generated Prisma client will be updated when prisma generate is run

export const WorkflowScheduleStatus = {
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  AUTO_PAUSED: 'AUTO_PAUSED',
  COMPLETED: 'COMPLETED',
  ARCHIVED: 'ARCHIVED',
} as const;

export type WorkflowScheduleStatus = (typeof WorkflowScheduleStatus)[keyof typeof WorkflowScheduleStatus];

export const WorkflowScheduleOccurrenceStatus = {
  PENDING: 'PENDING',
  DISPATCHED: 'DISPATCHED',
  SUCCEEDED: 'SUCCEEDED',
  SKIPPED: 'SKIPPED',
  TIMED_OUT: 'TIMED_OUT',
  CANCELLED: 'CANCELLED',
} as const;

export type WorkflowScheduleOccurrenceStatus = (typeof WorkflowScheduleOccurrenceStatus)[keyof typeof WorkflowScheduleOccurrenceStatus];
