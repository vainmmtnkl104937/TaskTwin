import { PublishReadinessReportSchema } from '@tasktwin/workflow-lifecycle';
import { WorkspaceExecutionPolicyDefinitionSchema } from '@tasktwin/workflow-policy';
import {
  AUDIT_PAYLOAD_SCHEMAS,
  AUDIT_EVENT_TYPES,
  type AuditEventType,
  type AuditActor,
  type AuditEntityRef,
} from '@tasktwin/audit-trail';
export {
  ApprovalDecisionResponseSchema,
  ApprovalRequestDetailResponseSchema,
  ApprovalRequestListResponseSchema,
} from '@tasktwin/workflow-approval';
export type { SafeApprovalRequest } from '@tasktwin/workflow-approval';
export {
  RepairDecisionResponseSchema,
  RepairRequestDetailResponseSchema,
  RepairRequestListResponseSchema,
} from '@tasktwin/workflow-recovery';
export type { SafeRepairRequest } from '@tasktwin/workflow-recovery';
import {
  PairingActionResponseSchema,
  PairingInspectionResponseSchema,
  RunnerDeviceListResponseSchema,
  RunnerDeviceRevokeResponseSchema,
} from '@tasktwin/runner-protocol';
export {
  RunInputPreparationResponseSchema,
  CreateWorkflowRunResponseSchema,
  WorkflowRunCancellationResponseSchema,
  WorkflowRunDetailResponseSchema,
  WorkflowRunListResponseSchema,
} from '@tasktwin/run-protocol';
export type {
  WorkflowRunDetail,
  WorkflowRunStatus,
} from '@tasktwin/run-protocol';
import {
  WorkflowDefinitionSchema,
  WorkflowLifecycleStatusSchema,
} from '@tasktwin/workflow-schema';
import { z } from 'zod';
import { ReleaseManifestSchema } from '@tasktwin/runner-release';
import {
  RunnerReleaseCatalogStatusSchema,
  RunnerReleaseStatusReasonSchema,
  RunnerRolloutAssignmentStatusSchema,
  RunnerRolloutStageStatusSchema,
  RunnerRolloutStatusSchema,
} from '@tasktwin/runner-rollout';

const UuidSchema = z.string().uuid();
const IsoDateSchema = z.string().datetime({ offset: true });
const RoleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']);
const StatusSchema = WorkflowLifecycleStatusSchema;

export const SafeExecutionPolicyVersionSchema = z.strictObject({
  id: UuidSchema,
  workspaceId: UuidSchema,
  revision: z.number().int().positive(),
  status: z.enum(['ACTIVE', 'ARCHIVED']),
  definition: WorkspaceExecutionPolicyDefinitionSchema,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  clientVersionId: UuidSchema,
  createdByUserId: UuidSchema,
  activatedAt: IsoDateSchema,
  archivedAt: IsoDateSchema.nullable(),
  createdAt: IsoDateSchema,
});

const ExecutionPolicyAccessSchema = z.strictObject({
  role: RoleSchema,
  canEdit: z.boolean(),
});

export const ActiveExecutionPolicyResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workspaceId: UuidSchema,
  access: ExecutionPolicyAccessSchema,
  active: SafeExecutionPolicyVersionSchema,
});

export const ExecutionPolicyVersionListResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workspaceId: UuidSchema,
  access: ExecutionPolicyAccessSchema,
  versions: z.array(SafeExecutionPolicyVersionSchema).max(1_000),
});

export const CreateExecutionPolicyVersionResponseSchema =
  ActiveExecutionPolicyResponseSchema.extend({ idempotent: z.boolean() });
const AccessSchema = z.strictObject({
  role: RoleSchema,
  canEdit: z.boolean(),
});

export const LoginResponseSchema = z.strictObject({
  user: z.strictObject({
    id: UuidSchema,
    email: z.string().email(),
    displayName: z.string().min(1),
    isActive: z.boolean(),
    isSystemAdministrator: z.boolean(),
    createdAt: IsoDateSchema,
    updatedAt: IsoDateSchema,
  }),
  accessToken: z.string().min(1),
});

export const RunnerReleaseSchema = z.strictObject({
  id: UuidSchema,
  product: z.string(),
  version: z.string(),
  manifestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  manifest: ReleaseManifestSchema,
  signingKeyId: z.string(),
  sourceCommit: z.string(),
  builtAt: IsoDateSchema,
  status: RunnerReleaseCatalogStatusSchema,
  statusReasonCode: RunnerReleaseStatusReasonSchema.nullable(),
  importedByUserId: UuidSchema,
  statusChangedByUserId: UuidSchema.nullable(),
  statusChangedAt: IsoDateSchema.nullable(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});

const RunnerRolloutAssignmentSchema = z.strictObject({
  id: UuidSchema,
  runnerDeviceId: UuidSchema,
  runnerDisplayName: z.string(),
  status: RunnerRolloutAssignmentStatusSchema,
  baselineVersion: z.string().nullable(),
  lastObservedVersion: z.string().nullable(),
  assignedAt: IsoDateSchema.nullable(),
  convergedAt: IsoDateSchema.nullable(),
  rolledBackAt: IsoDateSchema.nullable(),
});

const RunnerRolloutStageSchema = z.strictObject({
  id: UuidSchema,
  stageNumber: z.number().int().positive(),
  status: RunnerRolloutStageStatusSchema,
  reviewReason: z.string().nullable(),
  activatedAt: IsoDateSchema.nullable(),
  completedAt: IsoDateSchema.nullable(),
  assignments: z.array(RunnerRolloutAssignmentSchema),
});

export const RunnerRolloutSchema = z.strictObject({
  id: UuidSchema,
  workspaceId: UuidSchema,
  clientRolloutId: UuidSchema,
  status: RunnerRolloutStatusSchema,
  reviewReason: z.string().nullable(),
  targetRelease: z.strictObject({
    id: UuidSchema,
    product: z.string(),
    version: z.string(),
    status: RunnerReleaseCatalogStatusSchema,
  }),
  createdByUserId: UuidSchema,
  activatedAt: IsoDateSchema.nullable(),
  pausedAt: IsoDateSchema.nullable(),
  completedAt: IsoDateSchema.nullable(),
  cancelledAt: IsoDateSchema.nullable(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  stages: z.array(RunnerRolloutStageSchema),
});

const RunnerRolloutAccessSchema = z.strictObject({
  organizationId: UuidSchema,
  userId: UuidSchema,
  role: RoleSchema,
});

export const RunnerRolloutListResponseSchema = z.strictObject({
  access: RunnerRolloutAccessSchema,
  rollouts: z.array(RunnerRolloutSchema),
});
export const RunnerRolloutDetailResponseSchema = z.strictObject({
  access: RunnerRolloutAccessSchema,
  rollout: RunnerRolloutSchema,
});
export const RunnerRolloutMutationResponseSchema = RunnerRolloutSchema;
export const RunnerRolloutCreateResponseSchema = z.strictObject({
  rollout: RunnerRolloutSchema,
  idempotent: z.boolean(),
});

export type RunnerReleaseResponse = z.infer<typeof RunnerReleaseSchema>;
export type RunnerRolloutResponse = z.infer<typeof RunnerRolloutSchema>;

export const WorkspaceListResponseSchema = z.strictObject({
  workspaces: z.array(
    z.strictObject({
      id: UuidSchema,
      organizationId: UuidSchema,
      name: z.string().min(1),
      slug: z.string().min(1),
      createdAt: IsoDateSchema,
      updatedAt: IsoDateSchema,
      role: RoleSchema,
      canManageRunners: z.boolean(),
    }),
  ),
});

const WorkflowVersionSchema = z.strictObject({
  id: UuidSchema,
  workflowId: z.string().min(1),
  version: z.number().int().positive(),
  revision: z.number().int().positive(),
  status: StatusSchema,
  schemaVersion: z.literal(1),
  definition: WorkflowDefinitionSchema,
  createdFromVersionId: UuidSchema.nullable(),
  publishedAt: IsoDateSchema.nullable(),
  publishedById: UuidSchema.nullable(),
  archivedAt: IsoDateSchema.nullable(),
  archivedById: UuidSchema.nullable(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});

export const WorkspaceWorkflowListResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workspaceId: UuidSchema,
  access: AccessSchema,
  workflows: z.array(
    z.strictObject({
      id: z.string().min(1),
      name: z.string().min(1),
      description: z.string().nullable(),
      latestVersionId: UuidSchema,
      version: z.number().int().positive(),
      revision: z.number().int().positive(),
      status: StatusSchema,
      updatedAt: IsoDateSchema,
    }),
  ),
});

export const WorkflowVersionDetailResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workspaceId: UuidSchema,
  access: AccessSchema,
  workflowVersion: WorkflowVersionSchema,
  locatorMetadata: z.array(
    z.strictObject({
      stepId: z.string().min(1),
      confidence: z.enum(['high', 'medium', 'low']),
      provenance: z.string().min(1).max(64),
    }),
  ),
  publishReadiness: PublishReadinessReportSchema,
});

export const WorkflowLifecycleActionResponseSchema =
  WorkflowVersionDetailResponseSchema.extend({
    idempotent: z.boolean(),
  });

export const WorkflowVersionHistoryResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workflowId: z.string().trim().min(1).max(256),
  workspaceId: UuidSchema,
  access: z.strictObject({
    role: RoleSchema,
    canEdit: z.boolean(),
    canPublish: z.boolean(),
  }),
  versions: z.array(
    z.strictObject({
      id: UuidSchema,
      workflowId: z.string().trim().min(1).max(256),
      version: z.number().int().positive(),
      revision: z.number().int().positive(),
      status: StatusSchema,
      schemaVersion: z.literal(1),
      createdFromVersionId: UuidSchema.nullable(),
      publishedAt: IsoDateSchema.nullable(),
      publishedById: UuidSchema.nullable(),
      archivedAt: IsoDateSchema.nullable(),
      archivedById: UuidSchema.nullable(),
      createdAt: IsoDateSchema,
      updatedAt: IsoDateSchema,
    }),
  ),
});

export const WorkflowLifecycleErrorResponseSchema = z.strictObject({
  code: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(240),
  currentRevision: z.number().int().positive().optional(),
  readiness: PublishReadinessReportSchema.optional(),
});

export const WorkflowConflictResponseSchema = z
  .object({
    code: z.literal('WORKFLOW_DRAFT_REVISION_CONFLICT'),
    currentRevision: z.number().int().positive().optional(),
  })
  .passthrough();

export const WorkflowDraftValidationErrorResponseSchema = z.strictObject({
  code: z.literal('WORKFLOW_INPUT_VALIDATION_FAILED'),
  message: z.string().min(1).max(240),
  issues: z.array(
    z.strictObject({
      code: z.string().min(1).max(80),
      message: z.string().min(1).max(240),
      path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
      stepId: z.string().min(1).optional(),
      stepIndex: z.number().int().nonnegative().optional(),
      variableName: z.string().min(1).optional(),
    }),
  ),
});

export type WorkspaceListResponse = z.infer<typeof WorkspaceListResponseSchema>;
export type WorkspaceWorkflowListResponse = z.infer<
  typeof WorkspaceWorkflowListResponseSchema
>;
export type WorkflowVersionDetailResponse = z.infer<
  typeof WorkflowVersionDetailResponseSchema
>;
export type WorkflowLifecycleActionResponse = z.infer<
  typeof WorkflowLifecycleActionResponseSchema
>;
export type WorkflowVersionHistoryResponse = z.infer<
  typeof WorkflowVersionHistoryResponseSchema
>;
export {
  PairingActionResponseSchema,
  PairingInspectionResponseSchema,
  RunnerDeviceListResponseSchema,
  RunnerDeviceRevokeResponseSchema,
};
export type {
  PairingActionResponse,
  PairingInspectionResponse,
  RunnerDeviceListResponse,
  RunnerDeviceRevokeResponse,
} from '@tasktwin/runner-protocol';

export const AuditActorDtoSchema = z.union([
  z.strictObject({ type: z.literal('user'), userId: UuidSchema }),
  z.strictObject({ type: z.literal('runner'), runnerDeviceId: UuidSchema }),
  z.strictObject({
    type: z.literal('system'),
    reason: z.enum([
      'automatic_expiry',
      'completion_reconciliation',
      'lease_expired',
      'policy_supersede',
      'run_cancelled',
    ]),
  }),
]) satisfies z.ZodType<AuditActor>;

export const AuditEntityRefDtoSchema = z.strictObject({
  kind: z.enum([
    'workflow',
    'workflow_version',
    'policy_version',
    'workflow_run',
    'workflow_run_step',
    'workflow_run_step_attempt',
    'workflow_run_output',
    'approval_request',
    'repair_request',
    'locator_repair_proposal',
    'locator_repair_candidate',
  ]),
  id: z.string().min(1).max(256),
}) satisfies z.ZodType<AuditEntityRef>;

const FORBIDDEN_AUDIT_KEYS = [
  'value',
  'text',
  'input',
  'secret',
  'token',
  'password',
  'ciphertext',
  'wrappedKey',
  'iv',
  'aad',
  'locator',
  'selector',
  'url',
  'href',
  'query',
  'fragment',
  'dom',
  'html',
  'screenshot',
  'stackTrace',
  'expectedValue',
  'observedValue',
  'expected',
  'observed',
  'rawError',
  'stack',
  'email',
  'userAgent',
  'ip',
  'username',
  'hostname',
  'outputLength',
  'outputHash',
] as const;

function makeTypedPayloadSchemas(): {
  [EventType in AuditEventType]: z.ZodType<
    z.infer<(typeof AUDIT_PAYLOAD_SCHEMAS)[EventType]>
  >;
} {
  const entries: Record<string, z.ZodType<unknown>> = {};
  for (const eventType of AUDIT_EVENT_TYPES) {
    entries[eventType] = AUDIT_PAYLOAD_SCHEMAS[eventType];
  }
  return entries as never;
}

const TYPED_PAYLOAD_SCHEMAS = makeTypedPayloadSchemas();

const TypedPayloadUnion = z.union(
  AUDIT_EVENT_TYPES.map(
    (eventType) => TYPED_PAYLOAD_SCHEMAS[eventType],
  ) as unknown as readonly [z.ZodType, ...z.ZodType[]],
);

const StrictTypedPayloadUnion = TypedPayloadUnion.superRefine((value, ctx) => {
  const inspect = (input: unknown, path: (string | number)[]): void => {
    if (input === null || typeof input !== 'object') {
      return;
    }
    if (Array.isArray(input)) {
      input.forEach((entry, index) => inspect(entry, [...path, index]));
      return;
    }
    for (const key of Object.keys(input as Record<string, unknown>)) {
      if ((FORBIDDEN_AUDIT_KEYS as readonly string[]).includes(key)) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, key],
          message: `Audit payload key '${key}' is forbidden in safe UI responses.`,
        });
      }
      inspect((input as Record<string, unknown>)[key], [...path, key]);
    }
  };
  inspect(value, []);
});

export const SafeAuditPayloadSchema = StrictTypedPayloadUnion;

export const SafeAuditEventDtoSchema = z.strictObject({
  id: UuidSchema,
  workspaceId: UuidSchema,
  sequence: z.number().int().positive(),
  eventType: z.enum(AUDIT_EVENT_TYPES),
  actor: AuditActorDtoSchema,
  primaryEntity: AuditEntityRefDtoSchema,
  relatedEntities: z.array(AuditEntityRefDtoSchema).max(8),
  occurredAt: IsoDateSchema,
  sourceId: z.string().min(1).max(160),
  correlationId: z.string().min(1).max(80).optional(),
  payload: SafeAuditPayloadSchema,
});

export const SafeAuditEventDetailDtoSchema = SafeAuditEventDtoSchema.extend({
  payloadDigest: z.string().regex(/^[0-9a-f]{64}$/),
  previousHash: z.string().regex(/^[0-9a-f]{64}$/),
  eventHash: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: IsoDateSchema,
});

export const AuditEventListResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workspaceId: UuidSchema,
  access: z.strictObject({
    role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']),
    canVerify: z.boolean(),
  }),
  events: z.array(SafeAuditEventDtoSchema).max(100),
  nextCursor: z
    .strictObject({
      sequence: z.number().int().positive(),
      id: UuidSchema,
      encoded: z.string().min(1).max(200),
    })
    .nullable(),
});

export const AuditEventDetailResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workspaceId: UuidSchema,
  event: SafeAuditEventDetailDtoSchema,
});

export const AuditVerifyRequestSchema = z.strictObject({
  fromSequence: z.number().int().positive().optional(),
  toSequence: z.number().int().positive().optional(),
  sampleLimit: z.number().int().min(1).max(200).default(100),
});

export const AuditVerifyResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workspaceId: UuidSchema,
  status: z.enum(['ok', 'tampered', 'sequence_gap']),
  checkedCount: z.number().int().min(0),
  firstSequence: z.number().int().positive().nullable(),
  lastSequence: z.number().int().positive().nullable(),
  headHash: z.string().regex(/^[0-9a-f]{64}$/),
  firstFailure: z
    .strictObject({
      sequence: z.number().int().positive(),
      kind: z.enum([
        'SEQUENCE_GAP',
        'PREVIOUS_HASH_MISMATCH',
        'PAYLOAD_DIGEST_MISMATCH',
        'EVENT_HASH_MISMATCH',
        'HEAD_HASH_MISMATCH',
      ]),
    })
    .optional(),
});

export const RunEvidenceResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workspaceId: UuidSchema,
  workflowRunId: UuidSchema,
  events: z.array(
    z.strictObject({
      id: UuidSchema,
      sequence: z.number().int().positive(),
      eventType: z.enum(AUDIT_EVENT_TYPES),
      actor: AuditActorDtoSchema,
      primaryEntity: AuditEntityRefDtoSchema,
      occurredAt: IsoDateSchema,
      payload: SafeAuditPayloadSchema,
    }),
  ),
});

export type SafeAuditEvent = z.infer<typeof SafeAuditEventDtoSchema>;
export type SafeAuditEventDetail = z.infer<
  typeof SafeAuditEventDetailDtoSchema
>;
export type AuditEventListResponse = z.infer<
  typeof AuditEventListResponseSchema
>;
export type AuditEventDetailResponse = z.infer<
  typeof AuditEventDetailResponseSchema
>;
export type AuditVerifyRequest = z.infer<typeof AuditVerifyRequestSchema>;
export type AuditVerifyResponse = z.infer<typeof AuditVerifyResponseSchema>;
export type RunEvidenceResponse = z.infer<typeof RunEvidenceResponseSchema>;

// ---------------------------------------------------------------------------
// Workflow Schedules
// ---------------------------------------------------------------------------

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

export const WorkflowScheduleRecordSchema = z.strictObject({
  id: UuidSchema,
  workspaceId: UuidSchema,
  workflowId: z.string().min(1),
  workflowVersionId: UuidSchema,
  workflowVersion: z.number().int().positive(),
  runnerDeviceId: UuidSchema,
  clientScheduleId: UuidSchema,
  name: z.string().min(1),
  definition: z.unknown(),
  definitionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  workflowDigest: z.string().regex(/^[a-f0-9]{64}$/),
  status: WorkflowScheduleStatusSchema,
  overlapPolicy: z.string(),
  misfirePolicy: z.string(),
  maxStartDelaySeconds: z.number().int().nonnegative(),
  nextOccurrenceAt: IsoDateSchema.nullable(),
  lastOccurrenceAt: IsoDateSchema.nullable(),
  autoPauseReason: z.string().nullable(),
  autoPausedAt: IsoDateSchema.nullable(),
  completedAt: IsoDateSchema.nullable(),
  archivedAt: IsoDateSchema.nullable(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});

export type WorkflowScheduleRecord = z.infer<
  typeof WorkflowScheduleRecordSchema
>;

export const WorkflowScheduleOccurrenceRecordSchema = z.strictObject({
  id: UuidSchema,
  scheduleId: UuidSchema,
  workflowRunId: UuidSchema.nullable(),
  scheduledFor: IsoDateSchema,
  startDeadlineAt: IsoDateSchema,
  status: WorkflowScheduleOccurrenceStatusSchema,
  skipReason: z.string().nullable(),
  skippedAt: IsoDateSchema.nullable(),
  dispatchedAt: IsoDateSchema.nullable(),
  completedAt: IsoDateSchema.nullable(),
  terminationCause: z.string().nullable(),
  createdAt: IsoDateSchema,
});

export type WorkflowScheduleOccurrenceRecord = z.infer<
  typeof WorkflowScheduleOccurrenceRecordSchema
>;

export const WorkflowScheduleAccessSchema = z.strictObject({
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']),
  canEdit: z.boolean(),
});

export const WorkflowScheduleListResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workspaceId: UuidSchema,
  access: WorkflowScheduleAccessSchema,
  schedules: z.array(WorkflowScheduleRecordSchema).max(1_000),
});

export type WorkflowScheduleListResponse = z.infer<
  typeof WorkflowScheduleListResponseSchema
>;

export const WorkflowScheduleResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workspaceId: UuidSchema,
  access: WorkflowScheduleAccessSchema,
  schedule: WorkflowScheduleRecordSchema,
});

export type WorkflowScheduleResponse = z.infer<
  typeof WorkflowScheduleResponseSchema
>;

export const OccurrenceListResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  scheduleId: UuidSchema,
  occurrences: z.array(WorkflowScheduleOccurrenceRecordSchema).max(1_000),
  nextCursor: z.string().nullable(),
});

export type OccurrenceListResponse = z.infer<
  typeof OccurrenceListResponseSchema
>;

export const CreateWorkflowScheduleRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workflowVersionId: UuidSchema,
  clientScheduleId: UuidSchema,
  name: z.string().min(1).max(120),
  definition: z.unknown(),
  runnerDeviceId: UuidSchema,
  overlapPolicy: z.enum(['skip']).default('skip'),
  misfirePolicy: z.enum(['skip']).default('skip'),
  maxStartDelaySeconds: z.number().int().min(30).max(3600).default(300),
});

export type CreateWorkflowScheduleRequest = z.infer<
  typeof CreateWorkflowScheduleRequestSchema
>;

export const CreateWorkflowScheduleResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  schedule: WorkflowScheduleRecordSchema,
});

export type CreateWorkflowScheduleResponse = z.infer<
  typeof CreateWorkflowScheduleResponseSchema
>;

import { OperationalAlertActionTargetSchema } from '@tasktwin/operational-alerts';

export const NotificationItemSchema = z.strictObject({
  id: UuidSchema,
  workspace: z.strictObject({
    id: UuidSchema,
    name: z.string().min(1).max(120),
  }),
  alertId: UuidSchema,
  type: z.enum([
    'approval_required',
    'repair_required',
    'run_failed',
    'run_timed_out',
    'run_interrupted',
    'schedule_auto_paused',
    'audit_integrity_failed',
    'runner_rollout_requires_review',
  ]),
  severity: z.enum(['info', 'warning', 'error', 'critical']),
  status: z.enum(['active', 'resolved', 'informational']),
  deliveredAt: z.string().datetime({ offset: true }),
  readAt: z.string().datetime({ offset: true }).nullable(),
  summary: z.strictObject({
    title: z.string().max(100),
    body: z.string().max(240),
    actionLabel: z.string().max(80),
  }),
  actionTarget: OperationalAlertActionTargetSchema,
});
export const NotificationListResponseSchema = z.strictObject({
  items: z.array(NotificationItemSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const NotificationUnreadCountSchema = z.strictObject({
  count: z.number().int().min(0),
});
export const NotificationReadResponseSchema = z.strictObject({
  id: UuidSchema,
  readAt: z.string().datetime({ offset: true }),
  idempotent: z.boolean(),
});
export const NotificationReadAllResponseSchema = z.strictObject({
  updatedCount: z.number().int().min(0),
  cutoff: z.string().datetime({ offset: true }),
  readAt: z.string().datetime({ offset: true }),
});
export type NotificationItem = z.infer<typeof NotificationItemSchema>;
