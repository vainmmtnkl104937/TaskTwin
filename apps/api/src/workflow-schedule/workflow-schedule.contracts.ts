import { z } from 'zod';

const UuidSchema = z.string().uuid();
const IsoDateSchema = z.string().datetime({ offset: true });

export const CreateWorkflowScheduleRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  clientScheduleId: UuidSchema,
  name: z.string().min(1).max(120),
  definition: z.unknown(),
  runnerDeviceId: UuidSchema,
  maxStartDelaySeconds: z
    .number()
    .int()
    .min(30)
    .max(3600)
    .default(300),
});

export const WorkflowScheduleDetailSchema = z.strictObject({
  id: UuidSchema,
  workspaceId: UuidSchema,
  workflowId: z.string(),
  workflowVersionId: UuidSchema,
  workflowVersion: z.number().int().positive(),
  runnerDeviceId: UuidSchema,
  clientScheduleId: UuidSchema,
  name: z.string(),
  definition: z.unknown(),
  definitionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  workflowDigest: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['ACTIVE', 'PAUSED', 'AUTO_PAUSED', 'COMPLETED', 'ARCHIVED']),
  overlapPolicy: z.string(),
  misfirePolicy: z.string(),
  maxStartDelaySeconds: z.number().int(),
  nextOccurrenceAt: IsoDateSchema.nullable(),
  lastOccurrenceAt: IsoDateSchema.nullable(),
  autoPauseReason: z.string().nullable(),
  autoPausedAt: IsoDateSchema.nullable(),
  completedAt: IsoDateSchema.nullable(),
  archivedAt: IsoDateSchema.nullable(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});

export const WorkflowScheduleResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  schedule: WorkflowScheduleDetailSchema,
  nextOccurrenceAt: IsoDateSchema.nullable(),
  ready: z.boolean(),
  readinessIssues: z.array(z.unknown()),
  idempotent: z.boolean(),
});

export type CreateWorkflowScheduleRequest = z.infer<
  typeof CreateWorkflowScheduleRequestSchema
>;
export type WorkflowScheduleResponse = z.infer<
  typeof WorkflowScheduleResponseSchema
>;
export type WorkflowScheduleDetail = z.infer<typeof WorkflowScheduleDetailSchema>;

const ScheduleAccessSchema = z.strictObject({
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']),
  canManage: z.boolean(),
});

export const WorkflowScheduleListResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workspaceId: UuidSchema,
  access: ScheduleAccessSchema,
  schedules: z.array(WorkflowScheduleDetailSchema),
});

export type WorkflowScheduleListResponse = z.infer<
  typeof WorkflowScheduleListResponseSchema
>;

export const WorkflowScheduleOccurrenceResponseSchema = z.strictObject({
  id: UuidSchema,
  scheduleId: UuidSchema,
  workflowRunId: UuidSchema.nullable(),
  scheduledFor: IsoDateSchema,
  startDeadlineAt: IsoDateSchema,
  status: z.enum([
    'PENDING',
    'DISPATCHED',
    'SUCCEEDED',
    'SKIPPED',
    'TIMED_OUT',
    'CANCELLED',
  ]),
  skipReason: z.string().nullable(),
  skippedAt: IsoDateSchema.nullable(),
  dispatchedAt: IsoDateSchema.nullable(),
  completedAt: IsoDateSchema.nullable(),
  terminationCause: z.string().nullable(),
  createdAt: IsoDateSchema,
});

export type WorkflowScheduleOccurrenceResponse = z.infer<
  typeof WorkflowScheduleOccurrenceResponseSchema
>;

export const OccurrenceListResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  scheduleId: UuidSchema,
  occurrences: z.array(WorkflowScheduleOccurrenceResponseSchema),
  nextCursor: z.string().nullable(),
});

export type OccurrenceListResponse = z.infer<typeof OccurrenceListResponseSchema>;
