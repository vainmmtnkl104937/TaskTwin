import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@tasktwin/database';
import {
  createSafeOperationalAlertSummary,
  OperationalAlertActionTargetSchema,
  OperationalAlertTemplateSchema,
} from '@tasktwin/operational-alerts';
import { DATABASE_CLIENT } from '../database/database.constants.js';
import type { NotificationListQuery, NotificationListResponse } from './notifications.contracts.js';

function encodeCursor(value: { deliveredAt: Date; id: string }): string {
  return Buffer.from(`${value.deliveredAt.toISOString()}|${value.id}`, 'utf8').toString('base64url');
}
function decodeCursor(value: string): { deliveredAt: Date; id: string } {
  const [timestamp, id, extra] = Buffer.from(value, 'base64url').toString('utf8').split('|');
  if (timestamp === undefined || id === undefined || extra !== undefined || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('invalid');
  const deliveredAt = new Date(timestamp);
  if (Number.isNaN(deliveredAt.getTime())) throw new Error('invalid');
  return { deliveredAt, id };
}

@Injectable()
export class NotificationsService {
  constructor(@Inject(DATABASE_CLIENT) private readonly prisma: PrismaClient) {}

  async list(userId: string, query: NotificationListQuery): Promise<NotificationListResponse> {
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const rows = await this.prisma.userNotification.findMany({
      where: {
        recipientUserId: userId,
        workspace: { organization: { members: { some: { userId, user: { isActive: true } } } } },
        ...(query.workspaceId === undefined ? {} : { workspaceId: query.workspaceId }),
        ...(query.unread === undefined ? {} : { readAt: query.unread ? null : { not: null } }),
        alert: { ...(query.severity === undefined ? {} : { severity: query.severity }),
          ...(query.alertType === undefined ? {} : { type: query.alertType }) },
        ...(cursor === undefined ? {} : { OR: [
          { deliveredAt: { lt: cursor.deliveredAt } },
          { deliveredAt: cursor.deliveredAt, id: { lt: cursor.id } },
        ] }),
      },
      include: { workspace: { select: { id: true, name: true } }, alert: true },
      orderBy: [{ deliveredAt: 'desc' }, { id: 'desc' }], take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((row) => {
        const template = OperationalAlertTemplateSchema.parse(row.alert.templateParameters);
        const actionTarget = OperationalAlertActionTargetSchema.parse(row.alert.actionTarget);
        return { id: row.id, workspace: row.workspace, alertId: row.alertId,
          type: row.alert.type, severity: row.alert.severity, status: row.alert.status,
          deliveredAt: row.deliveredAt.toISOString(), readAt: row.readAt?.toISOString() ?? null,
          summary: createSafeOperationalAlertSummary(template), actionTarget };
      }),
      nextCursor: hasMore && page.length > 0 ? encodeCursor(page[page.length - 1]!) : null,
    };
  }

  async unreadCount(userId: string, workspaceId?: string) {
    const count = await this.prisma.userNotification.count({ where: {
      recipientUserId: userId, readAt: null,
      ...(workspaceId === undefined ? {} : { workspaceId }),
      workspace: { organization: { members: { some: { userId, user: { isActive: true } } } } },
    } });
    return { count };
  }

  async markRead(userId: string, notificationId: string) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.userNotification.findFirst({ where: { id: notificationId, recipientUserId: userId } });
      if (row === null) throw new NotFoundException({ code: 'NOTIFICATION_NOT_FOUND', message: 'Notification not found.' });
      if (row.readAt !== null) return { id: row.id, readAt: row.readAt.toISOString(), idempotent: true };
      const now = (await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`)[0]?.now;
      if (now === undefined) throw new Error('DATABASE_TIME_UNAVAILABLE');
      await tx.userNotification.update({ where: { id: row.id }, data: { readAt: now } });
      return { id: row.id, readAt: now.toISOString(), idempotent: false };
    });
  }

  async markAllRead(userId: string, requestedCutoff: Date) {
    return this.prisma.$transaction(async (tx) => {
      const databaseNow = (await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`)[0]?.now;
      if (databaseNow === undefined) throw new Error('DATABASE_TIME_UNAVAILABLE');
      const cutoff = requestedCutoff < databaseNow ? requestedCutoff : databaseNow;
      const updated = await tx.userNotification.updateMany({ where: {
        recipientUserId: userId, readAt: null, deliveredAt: { lte: cutoff },
      }, data: { readAt: databaseNow } });
      return { updatedCount: updated.count, cutoff: cutoff.toISOString(), readAt: databaseNow.toISOString() };
    });
  }
}
