import { describe, expect, it } from 'vitest';

import {
  OperationalAlertActionTargetSchema,
  TrustedOperationalAlertInputSchema,
  canTransitionOperationalAlert,
  createNotificationOutboxDeduplicationKey,
  createOperationalAlertDeduplicationKey,
  createSafeOperationalAlertSummary,
  deriveInitialOperationalAlertStatus,
  deriveOperationalAlertSeverity,
  resolveOperationalAlertRecipients,
} from '../src/index.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const approvalRequestId = '00000000-0000-4000-8000-000000000002';
const workflowRunId = '00000000-0000-4000-8000-000000000003';

const approvalAlert = {
  schemaVersion: 1,
  workspaceId,
  type: 'approval_required',
  source: { type: 'approval_request', id: approvalRequestId },
  primaryEntity: { type: 'approval_request', id: approvalRequestId },
  relatedEntities: [{ type: 'workflow_run', id: workflowRunId }],
  template: {
    schemaVersion: 1,
    templateKey: 'approval_required.v1',
    approvalRequestId,
    workflowRunId,
    riskLevel: 'high',
    expiresAt: '2026-08-08T01:00:00.000Z',
  },
  actionTarget: {
    schemaVersion: 1,
    kind: 'approval',
    workspaceId,
    approvalRequestId,
  },
} as const;

describe('operational alert contracts', () => {
  it('accepts a valid strict alert contract', () => {
    expect(TrustedOperationalAlertInputSchema.parse(approvalAlert)).toEqual(
      approvalAlert,
    );
  });

  it('accepts the safe Runner update-required schedule auto-pause reason', () => {
    const workflowScheduleId = '00000000-0000-4000-8000-000000000020';
    const occurrenceId = '00000000-0000-4000-8000-000000000021';
    expect(
      TrustedOperationalAlertInputSchema.safeParse({
        schemaVersion: 1,
        workspaceId,
        type: 'schedule_auto_paused',
        source: {
          type: 'workflow_schedule_occurrence',
          id: occurrenceId,
        },
        primaryEntity: {
          type: 'workflow_schedule',
          id: workflowScheduleId,
        },
        relatedEntities: [
          { type: 'workflow_schedule_occurrence', id: occurrenceId },
        ],
        template: {
          schemaVersion: 1,
          templateKey: 'schedule_auto_paused.v1',
          workflowScheduleId,
          reason: 'runner_update_required',
          autoPausedAt: '2026-08-09T01:00:00.000Z',
          occurrenceId,
        },
        actionTarget: {
          schemaVersion: 1,
          kind: 'schedule',
          workspaceId,
          workflowScheduleId,
        },
      }).success,
    ).toBe(true);
  });

  it('rejects invalid alert types and unexpected properties', () => {
    expect(
      TrustedOperationalAlertInputSchema.safeParse({
        ...approvalAlert,
        type: 'user_defined',
      }).success,
    ).toBe(false);
    expect(
      TrustedOperationalAlertInputSchema.safeParse({
        ...approvalAlert,
        title: 'arbitrary',
      }).success,
    ).toBe(false);
    expect(
      TrustedOperationalAlertInputSchema.safeParse({
        ...approvalAlert,
        template: { ...approvalAlert.template, rawError: 'secret' },
      }).success,
    ).toBe(false);
    expect(
      TrustedOperationalAlertInputSchema.safeParse({
        ...approvalAlert,
        actionTarget: {
          ...approvalAlert.actionTarget,
          approvalRequestId: workflowRunId,
        },
      }).success,
    ).toBe(false);
  });

  it('derives severity and lifecycle from trusted type', () => {
    expect(deriveOperationalAlertSeverity('approval_required')).toBe('warning');
    expect(deriveOperationalAlertSeverity('audit_integrity_failed')).toBe(
      'critical',
    );
    expect(deriveInitialOperationalAlertStatus('run_failed')).toBe(
      'informational',
    );
    expect(deriveInitialOperationalAlertStatus('repair_required')).toBe(
      'active',
    );
    expect(deriveInitialOperationalAlertStatus('audit_integrity_failed')).toBe(
      'active',
    );
    expect(canTransitionOperationalAlert('active', 'resolved')).toBe(true);
    expect(canTransitionOperationalAlert('informational', 'resolved')).toBe(
      false,
    );
  });

  it('routes and deduplicates only eligible members', () => {
    const ownerId = '00000000-0000-4000-8000-000000000010';
    const adminId = '00000000-0000-4000-8000-000000000011';
    const memberId = '00000000-0000-4000-8000-000000000012';
    const viewerId = '00000000-0000-4000-8000-000000000013';
    const memberships = [
      { userId: ownerId, role: 'OWNER' as const, isActive: true },
      { userId: ownerId, role: 'OWNER' as const, isActive: true },
      { userId: adminId, role: 'ADMIN' as const, isActive: true },
      { userId: memberId, role: 'MEMBER' as const, isActive: true },
      { userId: viewerId, role: 'VIEWER' as const, isActive: true },
    ];
    expect(
      resolveOperationalAlertRecipients({
        type: 'approval_required',
        memberships,
      }),
    ).toEqual([ownerId, adminId].sort());
    expect(
      resolveOperationalAlertRecipients({
        type: 'run_failed',
        memberships,
        creatorUserId: ownerId,
      }),
    ).toEqual([ownerId, adminId].sort());
    expect(
      resolveOperationalAlertRecipients({
        type: 'run_failed',
        memberships,
        creatorUserId: memberId,
      }),
    ).toEqual([ownerId, adminId, memberId].sort());
    expect(
      resolveOperationalAlertRecipients({
        type: 'run_failed',
        memberships: [
          ...memberships,
          {
            userId: '00000000-0000-4000-8000-000000000014',
            role: 'ADMIN',
            isActive: false,
          },
        ],
      }),
    ).not.toContain('00000000-0000-4000-8000-000000000014');
  });

  it('validates typed action targets without arbitrary URLs', () => {
    expect(
      OperationalAlertActionTargetSchema.safeParse(approvalAlert.actionTarget)
        .success,
    ).toBe(true);
    expect(
      OperationalAlertActionTargetSchema.safeParse({
        ...approvalAlert.actionTarget,
        url: 'https://example.test/private?token=secret',
      }).success,
    ).toBe(false);
  });

  it('creates deterministic alert and outbox keys', () => {
    const first = createOperationalAlertDeduplicationKey(approvalAlert);
    expect(createOperationalAlertDeduplicationKey(approvalAlert)).toBe(first);
    const message = createNotificationOutboxDeduplicationKey({
      alertId: approvalRequestId,
      recipientUserId: workflowRunId,
    });
    expect(message).toContain('in_app');
  });

  it('safe summaries contain no prohibited data', () => {
    const summary = createSafeOperationalAlertSummary(approvalAlert.template);
    expect(JSON.stringify(summary)).not.toMatch(
      /runtime|password|secret|locator|https?:|rawError|ciphertext/i,
    );
  });
});
