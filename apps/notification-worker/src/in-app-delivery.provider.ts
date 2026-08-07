import type { PrismaClient } from '@tasktwin/database';
import { OperationalAlertActionTargetSchema, OperationalAlertTemplateSchema } from '@tasktwin/operational-alerts';

import type { NotificationDeliveryProvider, NotificationDeliveryResult } from './delivery-provider.js';

export class InAppNotificationDeliveryProvider implements NotificationDeliveryProvider {
  readonly channel = 'IN_APP' as const;
  constructor(private readonly prisma: PrismaClient) {}

  async deliver(messageId: string, workerId: string): Promise<NotificationDeliveryResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const message = await tx.notificationOutboxMessage.findFirst({
          where: { id: messageId, status: 'PROCESSING', lockedBy: workerId },
          include: { alert: true },
        });
        if (message === null) return { outcome: 'permanent', safeErrorCode: 'OUTBOX_LEASE_LOST' };
        if (!OperationalAlertTemplateSchema.safeParse(message.alert.templateParameters).success) {
          return { outcome: 'permanent', safeErrorCode: 'ALERT_TEMPLATE_INVALID' };
        }
        if (!OperationalAlertActionTargetSchema.safeParse(message.alert.actionTarget).success) {
          return { outcome: 'permanent', safeErrorCode: 'ALERT_ACTION_TARGET_INVALID' };
        }
        const member = await tx.organizationMember.findFirst({
          where: { userId: message.recipientUserId, user: { isActive: true },
            organization: { workspaces: { some: { id: message.workspaceId } } } },
          select: { role: true },
        });
        if (member === null) return { outcome: 'permanent', safeErrorCode: 'RECIPIENT_MEMBERSHIP_REVOKED' };
        const privileged = member.role === 'OWNER' || member.role === 'ADMIN';
        let creatorEligible = false;
        if (message.alert.type.startsWith('run_')) {
          creatorEligible = (await tx.workflowRun.count({ where: { id: message.alert.sourceId,
            workspaceId: message.workspaceId, createdByUserId: message.recipientUserId } })) === 1;
        } else if (message.alert.type === 'schedule_auto_paused') {
          creatorEligible = (await tx.workflowSchedule.count({ where: { id: message.alert.sourceId,
            workspaceId: message.workspaceId, createdByUserId: message.recipientUserId } })) === 1;
        }
        if (!privileged && !creatorEligible) {
          return { outcome: 'permanent', safeErrorCode: 'RECIPIENT_NO_LONGER_ELIGIBLE' };
        }
        const nowRows = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`;
        const deliveredAt = nowRows[0]?.now;
        if (deliveredAt === undefined) return { outcome: 'retryable', safeErrorCode: 'DATABASE_TIME_UNAVAILABLE' };
        await tx.userNotification.upsert({
          where: { alertId_recipientUserId: { alertId: message.alertId, recipientUserId: message.recipientUserId } },
          create: { alertId: message.alertId, recipientUserId: message.recipientUserId,
            workspaceId: message.workspaceId, deliveredAt }, update: {},
        });
        const updated = await tx.notificationOutboxMessage.updateMany({
          where: { id: message.id, status: 'PROCESSING', lockedBy: workerId },
          data: { status: 'DELIVERED', deliveredAt, lockedBy: null, lockedUntil: null, lastErrorCode: null },
        });
        return updated.count === 1 ? { outcome: 'delivered' }
          : { outcome: 'permanent', safeErrorCode: 'OUTBOX_LEASE_LOST' };
      });
    } catch {
      return { outcome: 'retryable', safeErrorCode: 'IN_APP_DELIVERY_TRANSIENT' };
    }
  }
}
