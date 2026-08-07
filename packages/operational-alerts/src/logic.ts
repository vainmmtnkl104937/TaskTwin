import { z } from 'zod';

import type {
  OperationalAlertSeverity,
  OperationalAlertStatus,
  OperationalAlertTemplate,
  OperationalAlertType,
  TrustedOperationalAlertInput,
} from './contracts.js';
import { AlertUuidSchema, TrustedOperationalAlertInputSchema } from './contracts.js';
import { OperationalAlertError } from './errors.js';
import { MAX_ALERT_RECIPIENTS } from './constants.js';

const INFORMATIONAL_TYPES = new Set<OperationalAlertType>([
  'run_failed',
  'run_timed_out',
  'run_interrupted',
]);

const SEVERITY_BY_TYPE = {
  approval_required: 'warning',
  repair_required: 'warning',
  run_failed: 'error',
  run_timed_out: 'error',
  run_interrupted: 'critical',
  schedule_auto_paused: 'error',
  audit_integrity_failed: 'critical',
} as const satisfies Record<OperationalAlertType, OperationalAlertSeverity>;

export function deriveOperationalAlertSeverity(
  type: OperationalAlertType,
): OperationalAlertSeverity {
  return SEVERITY_BY_TYPE[type];
}

export function deriveInitialOperationalAlertStatus(
  type: OperationalAlertType,
): OperationalAlertStatus {
  return INFORMATIONAL_TYPES.has(type) ? 'informational' : 'active';
}

export function canTransitionOperationalAlert(
  current: OperationalAlertStatus,
  next: OperationalAlertStatus,
): boolean {
  return current === 'active' && next === 'resolved';
}

export const WorkspaceRecipientCandidateSchema = z.strictObject({
  userId: AlertUuidSchema,
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']),
  isActive: z.boolean(),
});

export type WorkspaceRecipientCandidate = z.infer<
  typeof WorkspaceRecipientCandidateSchema
>;

export function resolveOperationalAlertRecipients(input: {
  type: OperationalAlertType;
  memberships: readonly WorkspaceRecipientCandidate[];
  creatorUserId?: string;
}): string[] {
  const creator = input.creatorUserId;
  const recipients = new Set<string>();
  for (const raw of input.memberships) {
    const member = WorkspaceRecipientCandidateSchema.parse(raw);
    if (!member.isActive) continue;
    const privileged = member.role === 'OWNER' || member.role === 'ADMIN';
    const creatorRouted =
      creator === member.userId &&
      (input.type === 'run_failed' ||
        input.type === 'run_timed_out' ||
        input.type === 'run_interrupted' ||
        input.type === 'schedule_auto_paused');
    if (privileged || creatorRouted) recipients.add(member.userId);
  }
  if (recipients.size > MAX_ALERT_RECIPIENTS) {
    throw new OperationalAlertError('OPERATIONAL_ALERT_RECIPIENTS_EXCEEDED');
  }
  return [...recipients].sort();
}

function segment(value: string): string {
  return `${value.length}:${value}`;
}

export function createOperationalAlertDeduplicationKey(
  input: Pick<TrustedOperationalAlertInput, 'workspaceId' | 'type' | 'source'>,
): string {
  return [
    'alert-v1',
    segment(input.workspaceId),
    segment(input.type),
    segment(input.source.type),
    segment(input.source.id),
  ].join('|');
}

export function createNotificationOutboxDeduplicationKey(input: {
  alertId: string;
  recipientUserId: string;
}): string {
  return `outbox-v1|${segment(AlertUuidSchema.parse(input.alertId))}|${segment(
    AlertUuidSchema.parse(input.recipientUserId),
  )}|6:in_app`;
}

export interface SafeOperationalAlertSummary {
  title: string;
  body: string;
  actionLabel: string;
}

export function createSafeOperationalAlertSummary(
  template: OperationalAlertTemplate,
): SafeOperationalAlertSummary {
  switch (template.templateKey) {
    case 'approval_required.v1':
      return {
        title: 'Approval required',
        body: 'A workflow run is waiting for an authorized decision.',
        actionLabel: 'Review approval',
      };
    case 'repair_required.v1':
      return {
        title: 'Repair decision required',
        body: 'A workflow run is waiting for a safe recovery decision.',
        actionLabel: 'Review repair',
      };
    case 'run_failed.v1':
      return {
        title: 'Workflow run failed',
        body: 'A workflow run reached a failed terminal state.',
        actionLabel: 'View run',
      };
    case 'run_timed_out.v1':
      return {
        title: 'Workflow run timed out',
        body: 'A workflow run reached its timeout boundary.',
        actionLabel: 'View run',
      };
    case 'run_interrupted.v1':
      return {
        title: 'Workflow run interrupted',
        body: 'A workflow run stopped with an interrupted outcome.',
        actionLabel: 'Review run',
      };
    case 'schedule_auto_paused.v1':
      return {
        title: 'Schedule automatically paused',
        body: 'A schedule requires review before it can run again.',
        actionLabel: 'Review schedule',
      };
    case 'audit_integrity_failed.v1':
      return {
        title: 'Audit integrity verification failed',
        body: 'The Workspace audit chain requires immediate review.',
        actionLabel: 'Review audit trail',
      };
  }
}

export function parseTrustedOperationalAlertInput(
  input: unknown,
): TrustedOperationalAlertInput {
  const parsed = TrustedOperationalAlertInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationalAlertError('OPERATIONAL_ALERT_INVALID', {
      cause: parsed.error,
    });
  }
  return parsed.data;
}
