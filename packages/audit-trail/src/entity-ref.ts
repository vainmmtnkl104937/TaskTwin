import { z } from 'zod';

export const AUDIT_ENTITY_KINDS = [
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
  'workflow_schedule',
  'workflow_schedule_occurrence',
  'operational_alert',
  'notification_outbox_message',
] as const;

export const AuditEntityKindSchema = z.enum(AUDIT_ENTITY_KINDS);
export const AuditEntityIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);

export const AuditEntityRefSchema = z
  .object({
    kind: AuditEntityKindSchema,
    id: AuditEntityIdSchema,
  })
  .strict();

export const RelatedAuditEntitiesSchema = z
  .array(AuditEntityRefSchema)
  .max(8);

export type AuditEntityKind = z.infer<typeof AuditEntityKindSchema>;
export type AuditEntityRef = z.infer<typeof AuditEntityRefSchema>;
