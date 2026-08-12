import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabaseClient,
  getRequiredDatabaseUrl,
  type PrismaClient,
} from '@tasktwin/database';
import { InAppNotificationDeliveryProvider } from '../src/in-app-delivery.provider.js';
import { NotificationOutboxStore } from '../src/outbox-store.js';

describe('notification outbox PostgreSQL concurrency', () => {
  let prisma: PrismaClient;
  const userId = randomUUID(),
    organizationId = randomUUID(),
    workspaceId = randomUUID();
  const alertId = randomUUID(),
    messageId = randomUUID();

  beforeAll(async () => {
    prisma = createDatabaseClient(getRequiredDatabaseUrl());
    await prisma.$connect();
    await prisma.user.create({
      data: {
        id: userId,
        email: `notification-${userId}@example.test`,
        passwordHash: 'integration-test-not-a-credential',
        displayName: 'Notification owner',
      },
    });
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: 'Notification integration',
        slug: `notification-${organizationId}`,
      },
    });
    await prisma.organizationMember.create({
      data: { userId, organizationId, role: 'OWNER' },
    });
    await prisma.workspace.create({
      data: {
        id: workspaceId,
        organizationId,
        name: 'Notification integration',
        slug: 'notification-integration',
      },
    });
    await prisma.operationalAlert.create({
      data: {
        id: alertId,
        workspaceId,
        type: 'approval_required',
        severity: 'warning',
        status: 'active',
        sourceType: 'approval_request',
        sourceId: randomUUID(),
        contractDigest: 'a'.repeat(64),
        primaryEntityType: 'approval_request',
        primaryEntityId: randomUUID(),
        relatedEntities: [],
        templateKey: 'approval_required.v1',
        templateVersion: 1,
        templateParameters: {
          schemaVersion: 1,
          templateKey: 'approval_required.v1',
          approvalRequestId: randomUUID(),
          workflowRunId: randomUUID(),
          riskLevel: 'high',
          expiresAt: '2026-08-08T02:00:00.000Z',
        },
        actionTarget: {
          schemaVersion: 1,
          kind: 'approval',
          workspaceId,
          approvalRequestId: randomUUID(),
        },
      },
    });
    await prisma.notificationOutboxMessage.create({
      data: {
        id: messageId,
        workspaceId,
        alertId,
        recipientUserId: userId,
        deduplicationKey: `integration:${messageId}`,
      },
    });
  });

  afterAll(async () => {
    await prisma.userNotification.deleteMany({ where: { workspaceId } });
    await prisma.notificationOutboxMessage.deleteMany({
      where: { workspaceId },
    });
    await prisma.workspaceAuditEvent.deleteMany({ where: { workspaceId } });
    await prisma.workspaceAuditChainHead.deleteMany({ where: { workspaceId } });
    await prisma.operationalAlert.deleteMany({ where: { workspaceId } });
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.organizationMember.delete({
      where: { userId_organizationId: { userId, organizationId } },
    });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('has exactly one winner across concurrent workers', async () => {
    const claims = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        new NotificationOutboxStore(prisma).claimDue({
          workerId: `integration-worker-${index}`,
          batchSize: 10,
          leaseSeconds: 30,
        }),
      ),
    );
    expect(
      claims.flat().filter((message) => message.id === messageId),
    ).toHaveLength(1);
  });

  it('rejects delivery after the worker lease expires', async () => {
    await prisma.notificationOutboxMessage.update({
      where: { id: messageId },
      data: {
        status: 'PROCESSING',
        lockedBy: 'stale-worker',
        lockedUntil: new Date(0),
      },
    });
    await expect(
      new InAppNotificationDeliveryProvider(prisma).deliver(
        messageId,
        'stale-worker',
      ),
    ).resolves.toEqual({
      outcome: 'permanent',
      safeErrorCode: 'OUTBOX_LEASE_LOST',
    });
  });

  it('recovers an expired lease and delivers idempotently', async () => {
    await prisma.notificationOutboxMessage.update({
      where: { id: messageId },
      data: { lockedUntil: new Date(0) },
    });
    const claimed = await new NotificationOutboxStore(prisma).claimDue({
      workerId: 'recovery-worker',
      batchSize: 1,
      leaseSeconds: 30,
    });
    expect(claimed).toHaveLength(1);
    const provider = new InAppNotificationDeliveryProvider(prisma);
    await expect(
      provider.deliver(messageId, 'recovery-worker'),
    ).resolves.toEqual({ outcome: 'delivered' });
    await prisma.notificationOutboxMessage.update({
      where: { id: messageId },
      data: {
        status: 'PROCESSING',
        lockedBy: 'retry-worker',
        lockedUntil: new Date(Date.now() + 30_000),
        deliveredAt: null,
      },
    });
    await expect(provider.deliver(messageId, 'retry-worker')).resolves.toEqual({
      outcome: 'delivered',
    });
    expect(
      await prisma.userNotification.count({
        where: { alertId, recipientUserId: userId },
      }),
    ).toBe(1);
  });
});
