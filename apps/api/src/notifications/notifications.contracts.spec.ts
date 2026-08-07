import { describe, expect, it } from 'vitest';
import { MarkAllReadSchema, NotificationListQuerySchema } from './notifications.contracts.js';

describe('notification API boundaries', () => {
  it('bounds pagination and accepts only supported filters', () => {
    expect(NotificationListQuerySchema.parse({ limit: 100, unread: true, severity: 'critical', alertType: 'audit_integrity_failed' }).limit).toBe(100);
    expect(NotificationListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(NotificationListQuerySchema.safeParse({ recipientUserId: '00000000-0000-4000-8000-000000000001' }).success).toBe(false);
  });

  it('requires a strict safe cutoff for mark-all', () => {
    expect(MarkAllReadSchema.safeParse({ cutoff: '2026-08-08T00:00:00.000Z' }).success).toBe(true);
    expect(MarkAllReadSchema.safeParse({ cutoff: '2026-08-08T00:00:00.000Z', recipientUserId: 'other' }).success).toBe(false);
  });
});
