import { z } from 'zod';
import { OperationalAlertSeveritySchema, OperationalAlertTypeSchema,
  type OperationalAlertActionTarget, type OperationalAlertSeverity,
  type OperationalAlertStatus, type OperationalAlertType } from '@tasktwin/operational-alerts';

export const NotificationListQuerySchema = z.strictObject({
  workspaceId: z.string().uuid().optional(),
  unread: z.boolean().optional(),
  severity: OperationalAlertSeveritySchema.optional(),
  alertType: OperationalAlertTypeSchema.optional(),
  limit: z.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(512).optional(),
});
export const MarkAllReadSchema = z.strictObject({
  cutoff: z.string().datetime({ offset: true }),
});
export type NotificationListQuery = z.infer<typeof NotificationListQuerySchema>;
export interface NotificationListResponse {
  items: Array<{
    id: string; workspace: { id: string; name: string }; alertId: string;
    type: OperationalAlertType; severity: OperationalAlertSeverity; status: OperationalAlertStatus;
    deliveredAt: string; readAt: string | null;
    summary: { title: string; body: string; actionLabel: string };
    actionTarget: OperationalAlertActionTarget;
  }>;
  nextCursor: string | null;
}
