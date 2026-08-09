import { z } from 'zod';

import {
  NOTIFICATION_CHANNELS,
  OPERATIONAL_ALERT_ENTITY_TYPES,
  OPERATIONAL_ALERT_SCHEMA_VERSION,
  OPERATIONAL_ALERT_SEVERITIES,
  OPERATIONAL_ALERT_SOURCE_TYPES,
  OPERATIONAL_ALERT_STATUSES,
  OPERATIONAL_ALERT_TYPES,
} from './constants.js';

export const StableAlertIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
export const AlertUuidSchema = z.string().uuid();
export const SafeTimestampSchema = z.string().datetime({ offset: true });
export const BoundedCountSchema = z.number().int().min(0).max(1_000_000);
export const SafeCodeSchema = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[A-Z][A-Z0-9_]*$/);

export const OperationalAlertTypeSchema = z.enum(OPERATIONAL_ALERT_TYPES);
export const OperationalAlertSeveritySchema = z.enum(
  OPERATIONAL_ALERT_SEVERITIES,
);
export const OperationalAlertStatusSchema = z.enum(OPERATIONAL_ALERT_STATUSES);
export const OperationalAlertSourceTypeSchema = z.enum(
  OPERATIONAL_ALERT_SOURCE_TYPES,
);
export const OperationalAlertEntityTypeSchema = z.enum(
  OPERATIONAL_ALERT_ENTITY_TYPES,
);
export const NotificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);

export const OperationalAlertEntityRefSchema = z.strictObject({
  type: OperationalAlertEntityTypeSchema,
  id: StableAlertIdSchema,
});

export const OperationalAlertSourceBindingSchema = z.strictObject({
  type: OperationalAlertSourceTypeSchema,
  id: StableAlertIdSchema,
});

const WorkspaceActionBaseSchema = z.strictObject({
  schemaVersion: z.literal(OPERATIONAL_ALERT_SCHEMA_VERSION),
  workspaceId: AlertUuidSchema,
});

export const ApprovalActionTargetSchema = WorkspaceActionBaseSchema.extend({
  kind: z.literal('approval'),
  approvalRequestId: AlertUuidSchema,
});
export const RepairActionTargetSchema = WorkspaceActionBaseSchema.extend({
  kind: z.literal('repair'),
  repairRequestId: AlertUuidSchema,
});
export const RunActionTargetSchema = WorkspaceActionBaseSchema.extend({
  kind: z.literal('run'),
  workflowRunId: AlertUuidSchema,
});
export const ScheduleActionTargetSchema = WorkspaceActionBaseSchema.extend({
  kind: z.literal('schedule'),
  workflowScheduleId: AlertUuidSchema,
});
export const AuditActionTargetSchema = WorkspaceActionBaseSchema.extend({
  kind: z.literal('audit'),
});

export const OperationalAlertActionTargetSchema = z.discriminatedUnion('kind', [
  ApprovalActionTargetSchema,
  RepairActionTargetSchema,
  RunActionTargetSchema,
  ScheduleActionTargetSchema,
  AuditActionTargetSchema,
]);

const TemplateBaseSchema = z.strictObject({
  schemaVersion: z.literal(OPERATIONAL_ALERT_SCHEMA_VERSION),
});

export const ApprovalRequiredTemplateSchema = TemplateBaseSchema.extend({
  templateKey: z.literal('approval_required.v1'),
  approvalRequestId: AlertUuidSchema,
  workflowRunId: AlertUuidSchema,
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
  expiresAt: SafeTimestampSchema,
});
export const RepairRequiredTemplateSchema = TemplateBaseSchema.extend({
  templateKey: z.literal('repair_required.v1'),
  repairRequestId: AlertUuidSchema,
  workflowRunId: AlertUuidSchema,
  stepType: z.enum([
    'navigate',
    'click',
    'fill',
    'select',
    'setChecked',
    'wait',
    'extract',
    'verify',
    'approval',
  ]),
  attemptNumber: z.number().int().min(1).max(3),
  expiresAt: SafeTimestampSchema,
});
export const RunFailedTemplateSchema = TemplateBaseSchema.extend({
  templateKey: z.literal('run_failed.v1'),
  workflowRunId: AlertUuidSchema,
  failedAt: SafeTimestampSchema,
});
export const RunTimedOutTemplateSchema = TemplateBaseSchema.extend({
  templateKey: z.literal('run_timed_out.v1'),
  workflowRunId: AlertUuidSchema,
  timedOutAt: SafeTimestampSchema,
});
export const RunInterruptedTemplateSchema = TemplateBaseSchema.extend({
  templateKey: z.literal('run_interrupted.v1'),
  workflowRunId: AlertUuidSchema,
  interruptedAt: SafeTimestampSchema,
});
export const ScheduleAutoPausedTemplateSchema = TemplateBaseSchema.extend({
  templateKey: z.literal('schedule_auto_paused.v1'),
  workflowScheduleId: AlertUuidSchema,
  reason: z.enum([
    'policy_review_required',
    'source_version_unavailable',
    'ambiguous_outcome',
    'secret_readiness_failed',
    'runner_update_required',
  ]),
  autoPausedAt: SafeTimestampSchema,
  occurrenceId: AlertUuidSchema.optional(),
});
export const AuditIntegrityFailedTemplateSchema = TemplateBaseSchema.extend({
  templateKey: z.literal('audit_integrity_failed.v1'),
  failureKind: z.enum([
    'SEQUENCE_GAP',
    'PREVIOUS_HASH_MISMATCH',
    'PAYLOAD_DIGEST_MISMATCH',
    'EVENT_HASH_MISMATCH',
    'HEAD_HASH_MISMATCH',
  ]),
  failureSequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  verifiedAt: SafeTimestampSchema,
});

export const OperationalAlertTemplateSchema = z.discriminatedUnion(
  'templateKey',
  [
    ApprovalRequiredTemplateSchema,
    RepairRequiredTemplateSchema,
    RunFailedTemplateSchema,
    RunTimedOutTemplateSchema,
    RunInterruptedTemplateSchema,
    ScheduleAutoPausedTemplateSchema,
    AuditIntegrityFailedTemplateSchema,
  ],
);

export const TrustedOperationalAlertInputSchema = z
  .strictObject({
    schemaVersion: z.literal(OPERATIONAL_ALERT_SCHEMA_VERSION),
    workspaceId: AlertUuidSchema,
    type: OperationalAlertTypeSchema,
    source: OperationalAlertSourceBindingSchema,
    primaryEntity: OperationalAlertEntityRefSchema,
    relatedEntities: z
      .array(OperationalAlertEntityRefSchema)
      .max(8)
      .default([]),
    template: OperationalAlertTemplateSchema,
    actionTarget: OperationalAlertActionTargetSchema,
    creatorUserId: AlertUuidSchema.optional(),
  })
  .superRefine((input, context) => {
    const expected = {
      approval_required: [
        'approval_request',
        'approval_required.v1',
        'approval',
      ],
      repair_required: ['repair_request', 'repair_required.v1', 'repair'],
      run_failed: ['workflow_run', 'run_failed.v1', 'run'],
      run_timed_out: ['workflow_run', 'run_timed_out.v1', 'run'],
      run_interrupted: ['workflow_run', 'run_interrupted.v1', 'run'],
      schedule_auto_paused: [
        'workflow_schedule',
        'schedule_auto_paused.v1',
        'schedule',
      ],
      audit_integrity_failed: [
        'audit_verification_failure',
        'audit_integrity_failed.v1',
        'audit',
      ],
    } as const;
    const [sourceType, templateKey, actionKind] = expected[input.type];
    const sourceTypeMatches =
      input.source.type === sourceType ||
      (input.type === 'schedule_auto_paused' &&
        input.source.type === 'workflow_schedule_occurrence');
    if (!sourceTypeMatches) {
      context.addIssue({
        code: 'custom',
        path: ['source', 'type'],
        message: 'Alert source type does not match the alert type.',
      });
    }
    if (input.template.templateKey !== templateKey) {
      context.addIssue({
        code: 'custom',
        path: ['template', 'templateKey'],
        message: 'Alert template does not match the alert type.',
      });
    }
    if (input.actionTarget.kind !== actionKind) {
      context.addIssue({
        code: 'custom',
        path: ['actionTarget', 'kind'],
        message: 'Alert action target does not match the alert type.',
      });
    }
    if (input.actionTarget.workspaceId !== input.workspaceId) {
      context.addIssue({
        code: 'custom',
        path: ['actionTarget', 'workspaceId'],
        message: 'Action target must belong to the alert Workspace.',
      });
    }
    const mismatch = (path: PropertyKey[], message: string): void => {
      context.addIssue({ code: 'custom', path, message });
    };
    switch (input.type) {
      case 'approval_required':
        if (
          input.template.templateKey !== 'approval_required.v1' ||
          input.actionTarget.kind !== 'approval' ||
          input.source.id !== input.template.approvalRequestId ||
          input.source.id !== input.actionTarget.approvalRequestId ||
          input.primaryEntity.type !== 'approval_request' ||
          input.primaryEntity.id !== input.source.id
        ) {
          mismatch(['source', 'id'], 'Approval alert identities must match.');
        }
        break;
      case 'repair_required':
        if (
          input.template.templateKey !== 'repair_required.v1' ||
          input.actionTarget.kind !== 'repair' ||
          input.source.id !== input.template.repairRequestId ||
          input.source.id !== input.actionTarget.repairRequestId ||
          input.primaryEntity.type !== 'repair_request' ||
          input.primaryEntity.id !== input.source.id
        ) {
          mismatch(['source', 'id'], 'Repair alert identities must match.');
        }
        break;
      case 'run_failed':
      case 'run_timed_out':
      case 'run_interrupted':
        if (
          !['run_failed.v1', 'run_timed_out.v1', 'run_interrupted.v1'].includes(
            input.template.templateKey,
          ) ||
          input.actionTarget.kind !== 'run' ||
          !('workflowRunId' in input.template) ||
          input.source.id !== input.template.workflowRunId ||
          input.source.id !== input.actionTarget.workflowRunId ||
          input.primaryEntity.type !== 'workflow_run' ||
          input.primaryEntity.id !== input.source.id
        ) {
          mismatch(['source', 'id'], 'Run alert identities must match.');
        }
        break;
      case 'schedule_auto_paused': {
        if (
          input.template.templateKey !== 'schedule_auto_paused.v1' ||
          input.actionTarget.kind !== 'schedule'
        ) {
          mismatch(['source', 'id'], 'Schedule alert identities must match.');
          break;
        }
        const sourceIdentityMatches =
          (input.source.type === 'workflow_schedule' &&
            input.source.id === input.template.workflowScheduleId) ||
          (input.source.type === 'workflow_schedule_occurrence' &&
            input.template.occurrenceId !== undefined &&
            input.source.id === input.template.occurrenceId);
        if (
          !sourceIdentityMatches ||
          input.template.workflowScheduleId !==
            input.actionTarget.workflowScheduleId ||
          input.primaryEntity.type !== 'workflow_schedule' ||
          input.primaryEntity.id !== input.template.workflowScheduleId
        ) {
          mismatch(['source', 'id'], 'Schedule alert identities must match.');
        }
        break;
      }
      case 'audit_integrity_failed':
        if (
          input.primaryEntity.type !== 'workspace_audit_chain' ||
          input.primaryEntity.id !== input.workspaceId
        ) {
          mismatch(
            ['primaryEntity'],
            'Audit integrity alerts must bind the Workspace audit chain.',
          );
        }
        break;
    }
  });

export type OperationalAlertType = z.infer<typeof OperationalAlertTypeSchema>;
export type OperationalAlertSeverity = z.infer<
  typeof OperationalAlertSeveritySchema
>;
export type OperationalAlertStatus = z.infer<
  typeof OperationalAlertStatusSchema
>;
export type OperationalAlertSourceType = z.infer<
  typeof OperationalAlertSourceTypeSchema
>;
export type OperationalAlertTemplate = z.infer<
  typeof OperationalAlertTemplateSchema
>;
export type OperationalAlertActionTarget = z.infer<
  typeof OperationalAlertActionTargetSchema
>;
export type TrustedOperationalAlertInput = z.infer<
  typeof TrustedOperationalAlertInputSchema
>;
