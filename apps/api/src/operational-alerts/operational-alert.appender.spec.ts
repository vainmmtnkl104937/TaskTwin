import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseTransactionClient } from '@tasktwin/database';

vi.mock('@tasktwin/database', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tasktwin/database')>();
  return { ...original, appendAuditEventTransactional: vi.fn(async () => ({ event: {}, idempotent: false })) };
});

import { OperationalAlertAppender } from './operational-alert.appender.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const approvalId = '00000000-0000-4000-8000-000000000002';
const runId = '00000000-0000-4000-8000-000000000003';
const alertId = '00000000-0000-4000-8000-000000000004';
const input = {
  schemaVersion: 1 as const, workspaceId, type: 'approval_required' as const,
  source: { type: 'approval_request' as const, id: approvalId },
  primaryEntity: { type: 'approval_request' as const, id: approvalId },
  relatedEntities: [{ type: 'workflow_run' as const, id: runId }],
  template: { schemaVersion: 1 as const, templateKey: 'approval_required.v1' as const,
    approvalRequestId: approvalId, workflowRunId: runId, riskLevel: 'high' as const,
    expiresAt: '2026-08-08T02:00:00.000Z' },
  actionTarget: { schemaVersion: 1 as const, kind: 'approval' as const, workspaceId, approvalRequestId: approvalId },
};

describe('OperationalAlertAppender', () => {
  const createMany = vi.fn(async (args: { data: unknown[]; skipDuplicates: boolean }) => {
    void args;
    return { count: 2 };
  });
  let digest = '';
  const transaction = {
    workspace: { findUnique: vi.fn(async () => ({ organization: { members: [
      { userId: '00000000-0000-4000-8000-000000000010', role: 'OWNER', user: { isActive: true } },
      { userId: '00000000-0000-4000-8000-000000000011', role: 'ADMIN', user: { isActive: true } },
      { userId: '00000000-0000-4000-8000-000000000012', role: 'MEMBER', user: { isActive: true } },
      { userId: '00000000-0000-4000-8000-000000000013', role: 'ADMIN', user: { isActive: false } },
    ] } })) },
    operationalAlert: { upsert: vi.fn(async (args: { create: { contractDigest: string } }) => {
      digest ||= args.create.contractDigest;
      return { id: alertId, createdAt: new Date('2026-08-08T01:00:00.000Z'), contractDigest: digest };
    }) },
    notificationOutboxMessage: { createMany, count: vi.fn(async () => 2) },
  } as unknown as DatabaseTransactionClient;

  beforeEach(() => { digest = ''; createMany.mockClear(); });

  it('routes only active OWNER and ADMIN and requests idempotent inserts', async () => {
    const result = await new OperationalAlertAppender().append(transaction, input);
    expect(result.recipientCount).toBe(2);
    const call = createMany.mock.calls[0]?.[0];
    expect(call?.skipDuplicates).toBe(true);
    expect(call?.data).toHaveLength(2);
  });

  it('rejects conflicting reuse of the stable source identity', async () => {
    digest = 'f'.repeat(64);
    await expect(new OperationalAlertAppender().append(transaction, input)).rejects.toMatchObject({
      code: 'OPERATIONAL_ALERT_SOURCE_CONFLICT',
    });
  });

  it('propagates required outbox failure so the caller transaction rolls back', async () => {
    createMany.mockRejectedValueOnce(new Error('synthetic persistence failure'));
    await expect(new OperationalAlertAppender().append(transaction, input)).rejects.toThrow('synthetic persistence failure');
  });
});
