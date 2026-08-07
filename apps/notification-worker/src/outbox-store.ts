import {
  appendAuditEventTransactional,
  type PrismaClient,
  WorkspaceAuditTrailRepository,
} from '@tasktwin/database';
import { SafeCodeSchema } from '@tasktwin/operational-alerts';

import { MAX_DELIVERY_ATTEMPTS, retryDelaySeconds } from './retry-policy.js';

export interface ClaimedMessage {
  id: string;
  attemptCount: number;
  exhausted: boolean;
}

export class NotificationOutboxStore {
  constructor(private readonly prisma: PrismaClient) {}

  async claimDue(input: { workerId: string; batchSize: number; leaseSeconds: number }): Promise<ClaimedMessage[]> {
    const batchSize = Math.max(1, Math.min(100, Math.trunc(input.batchSize)));
    const leaseSeconds = Math.max(5, Math.min(300, Math.trunc(input.leaseSeconds)));
    return this.prisma.$queryRaw<ClaimedMessage[]>`
      WITH due AS (
        SELECT "id", ("status" = 'PROCESSING' AND "attempt_count" >= ${MAX_DELIVERY_ATTEMPTS}) AS "exhausted"
        FROM "notification_outbox_messages"
        WHERE (("status" = 'PENDING' AND "available_at" <= clock_timestamp())
          OR ("status" = 'PROCESSING' AND "locked_until" <= clock_timestamp()))
          AND ("attempt_count" < ${MAX_DELIVERY_ATTEMPTS}
            OR ("status" = 'PROCESSING' AND "attempt_count" = ${MAX_DELIVERY_ATTEMPTS}))
        ORDER BY "available_at", "id"
        FOR UPDATE SKIP LOCKED LIMIT ${batchSize}
      )
      UPDATE "notification_outbox_messages" AS message
      SET "status" = 'PROCESSING', "attempt_count" = CASE WHEN due."exhausted"
            THEN message."attempt_count" ELSE message."attempt_count" + 1 END,
          "locked_by" = ${input.workerId},
          "locked_until" = clock_timestamp() + (${leaseSeconds} * interval '1 second'),
          "updated_at" = clock_timestamp()
      FROM due WHERE message."id" = due."id"
      RETURNING message."id", message."attempt_count" AS "attemptCount", due."exhausted"
    `;
  }

  async retryOrDeadLetter(input: {
    messageId: string; workerId: string; attemptCount: number;
    retryable: boolean; safeErrorCode: string;
  }): Promise<'retry_scheduled' | 'dead_lettered' | 'lost_lease'> {
    const delay = input.retryable ? retryDelaySeconds(input.attemptCount) : null;
    const safeErrorCode = SafeCodeSchema.parse(input.safeErrorCode);
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.notificationOutboxMessage.findFirst({
        where: { id: input.messageId, status: 'PROCESSING', lockedBy: input.workerId },
        include: { alert: true },
      });
      if (locked === null) return 'lost_lease';
      if (delay !== null) {
        await tx.$executeRaw`
          UPDATE "notification_outbox_messages" SET "status" = 'PENDING',
            "available_at" = clock_timestamp() + (${delay} * interval '1 second'),
            "locked_by" = NULL, "locked_until" = NULL,
            "last_error_code" = ${safeErrorCode}, "updated_at" = clock_timestamp()
          WHERE "id" = ${input.messageId}::uuid AND "status" = 'PROCESSING'
            AND "locked_by" = ${input.workerId}
        `;
        return 'retry_scheduled';
      }
      const dead = await tx.$queryRaw<Array<{ deadLetteredAt: Date }>>`
        UPDATE "notification_outbox_messages" SET "status" = 'DEAD_LETTER',
          "locked_by" = NULL, "locked_until" = NULL, "last_error_code" = ${safeErrorCode},
          "dead_lettered_at" = clock_timestamp(), "updated_at" = clock_timestamp()
        WHERE "id" = ${input.messageId}::uuid AND "status" = 'PROCESSING'
          AND "locked_by" = ${input.workerId}
        RETURNING "dead_lettered_at" AS "deadLetteredAt"
      `;
      if (dead[0] === undefined) return 'lost_lease';
      await appendAuditEventTransactional(tx, new WorkspaceAuditTrailRepository(tx), {
        workspaceId: locked.workspaceId,
        eventType: 'notification.delivery.dead_lettered',
        actor: { type: 'system', reason: 'notification_worker' },
        primaryEntity: { kind: 'notification_outbox_message', id: locked.id },
        relatedEntities: [{ kind: 'operational_alert', id: locked.alertId }],
        occurredAt: dead[0].deadLetteredAt.toISOString(),
        sourceId: `notification-dead-lettered:${locked.id}`,
        payload: { alertId: locked.alertId, alertType: locked.alert.type,
          severity: locked.alert.severity, sourceType: locked.alert.sourceType,
          sourceId: locked.alert.sourceId, recipientCount: 1 },
      });
      return 'dead_lettered';
    });
  }
}
