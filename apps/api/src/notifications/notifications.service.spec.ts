import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@tasktwin/database';
import { describe, expect, it, vi } from 'vitest';
import { NotificationsService } from './notifications.service.js';

const userId = '00000000-0000-4000-8000-000000000001';
const notificationId = '00000000-0000-4000-8000-000000000002';
const deliveredAt = new Date('2026-08-08T01:00:00.000Z');
const databaseNow = new Date('2026-08-08T02:00:00.000Z');

function serviceWithTransaction(transaction: object): NotificationsService {
  const prisma = { $transaction: vi.fn(async (callback: (tx: object) => Promise<unknown>) => callback(transaction)) } as unknown as PrismaClient;
  return new NotificationsService(prisma);
}

describe('NotificationsService ownership and reads', () => {
  it('marks only the current user notification and is idempotent on retry', async () => {
    const update = vi.fn();
    const findFirst = vi.fn(async (): Promise<{ id: string; recipientUserId: string; deliveredAt: Date; readAt: Date | null }> =>
      ({ id: notificationId, recipientUserId: userId, deliveredAt, readAt: null }));
    const transaction = {
      userNotification: { findFirst, update },
      $queryRaw: vi.fn(async () => [{ now: databaseNow }]),
    };
    const service = serviceWithTransaction(transaction);
    await expect(service.markRead(userId, notificationId)).resolves.toEqual({ id: notificationId, readAt: databaseNow.toISOString(), idempotent: false });
    expect(transaction.userNotification.findFirst).toHaveBeenCalledWith({ where: { id: notificationId, recipientUserId: userId } });
    transaction.userNotification.findFirst.mockResolvedValueOnce({ id: notificationId, recipientUserId: userId, deliveredAt, readAt: databaseNow });
    await expect(service.markRead(userId, notificationId)).resolves.toMatchObject({ idempotent: true });
    expect(update).toHaveBeenCalledOnce();
  });

  it('does not expose another user notification', async () => {
    const service = serviceWithTransaction({ userNotification: { findFirst: vi.fn(async () => null) } });
    await expect(service.markRead(userId, notificationId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('bounds mark-all by the supplied cutoff so newer delivery remains unread', async () => {
    const updateMany = vi.fn(async () => ({ count: 3 }));
    const service = serviceWithTransaction({ userNotification: { updateMany }, $queryRaw: vi.fn(async () => [{ now: databaseNow }]) });
    const cutoff = new Date('2026-08-08T01:30:00.000Z');
    await expect(service.markAllRead(userId, cutoff)).resolves.toMatchObject({ updatedCount: 3, cutoff: cutoff.toISOString() });
    expect(updateMany).toHaveBeenCalledWith({ where: { recipientUserId: userId, readAt: null, deliveredAt: { lte: cutoff } }, data: { readAt: databaseNow } });
  });

  it('counts unread rows only for the current user', async () => {
    const count = vi.fn(async () => 4);
    const service = new NotificationsService({ userNotification: { count } } as unknown as PrismaClient);
    await expect(service.unreadCount(userId)).resolves.toEqual({ count: 4 });
    expect(count).toHaveBeenCalledWith({ where: expect.objectContaining({ recipientUserId: userId, readAt: null }) });
  });
});
