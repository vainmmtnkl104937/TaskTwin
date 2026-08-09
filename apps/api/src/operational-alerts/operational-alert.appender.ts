import { Injectable } from '@nestjs/common';
import {
  appendAuditEventTransactional,
  createCanonicalJsonDigest,
  type DatabaseTransactionClient,
  type OperationalAlertTransactionAppender,
  type ResolveOperationalAlertInput,
  WorkspaceAuditTrailRepository,
} from '@tasktwin/database';
import {
  createNotificationOutboxDeduplicationKey,
  deriveInitialOperationalAlertStatus,
  deriveOperationalAlertSeverity,
  parseTrustedOperationalAlertInput,
  resolveOperationalAlertRecipients,
  type TrustedOperationalAlertInput,
  OperationalAlertError,
} from '@tasktwin/operational-alerts';

@Injectable()
export class OperationalAlertAppender implements OperationalAlertTransactionAppender {
  async append(
    tx: DatabaseTransactionClient,
    rawInput: TrustedOperationalAlertInput,
  ): Promise<{ alertId: string; recipientCount: number; idempotent: boolean }> {
    const input = parseTrustedOperationalAlertInput(rawInput);
    const contractDigest = createCanonicalJsonDigest(input);
    const workspace = await tx.workspace.findUnique({
      where: { id: input.workspaceId },
      select: {
        organization: {
          select: {
            members: {
              where: { user: { isActive: true } },
              select: {
                userId: true,
                role: true,
                user: { select: { isActive: true } },
              },
            },
          },
        },
      },
    });
    if (workspace === null)
      throw new OperationalAlertError('OPERATIONAL_ALERT_WORKSPACE_NOT_FOUND');

    const recipients = resolveOperationalAlertRecipients({
      type: input.type,
      memberships: workspace.organization.members.map((member) => ({
        userId: member.userId,
        role: member.role,
        isActive: member.user.isActive,
      })),
      ...(input.creatorUserId === undefined
        ? {}
        : { creatorUserId: input.creatorUserId }),
    });
    const severity = deriveOperationalAlertSeverity(input.type);
    const status = deriveInitialOperationalAlertStatus(input.type);
    const alert = await tx.operationalAlert.upsert({
      where: {
        workspaceId_type_sourceType_sourceId: {
          workspaceId: input.workspaceId,
          type: input.type,
          sourceType: input.source.type,
          sourceId: input.source.id,
        },
      },
      create: {
        workspaceId: input.workspaceId,
        type: input.type,
        severity,
        status,
        sourceType: input.source.type,
        sourceId: input.source.id,
        contractDigest,
        primaryEntityType: input.primaryEntity.type,
        primaryEntityId: input.primaryEntity.id,
        relatedEntities: input.relatedEntities,
        templateKey: input.template.templateKey,
        templateVersion: input.template.schemaVersion,
        templateParameters: input.template,
        actionTarget: input.actionTarget,
      },
      update: {},
    });
    if (alert.contractDigest !== contractDigest) {
      throw new OperationalAlertError('OPERATIONAL_ALERT_SOURCE_CONFLICT');
    }

    const outbox = recipients.map((recipientUserId) => ({
      workspaceId: input.workspaceId,
      alertId: alert.id,
      recipientUserId,
      deduplicationKey: createNotificationOutboxDeduplicationKey({
        alertId: alert.id,
        recipientUserId,
      }),
    }));
    if (outbox.length > 0) {
      await tx.notificationOutboxMessage.createMany({
        data: outbox,
        skipDuplicates: true,
      });
    }
    const recipientCount = await tx.notificationOutboxMessage.count({
      where: { alertId: alert.id },
    });
    const audit = await appendAuditEventTransactional(
      tx,
      new WorkspaceAuditTrailRepository(tx),
      {
        workspaceId: input.workspaceId,
        eventType: 'notification.alert.created',
        actor: { type: 'system', reason: 'automatic' },
        primaryEntity: { kind: 'operational_alert', id: alert.id },
        relatedEntities: [],
        occurredAt: alert.createdAt.toISOString(),
        sourceId: `notification-alert-created:${alert.id}`,
        payload: {
          alertId: alert.id,
          alertType: input.type,
          severity,
          sourceType: input.source.type,
          sourceId: input.source.id,
          recipientCount,
        },
      },
    );
    return { alertId: alert.id, recipientCount, idempotent: audit.idempotent };
  }

  async resolve(
    tx: DatabaseTransactionClient,
    input: ResolveOperationalAlertInput,
  ): Promise<{ alertId: string; idempotent: boolean } | null> {
    const alert = await tx.operationalAlert.findUnique({
      where: {
        workspaceId_type_sourceType_sourceId: {
          workspaceId: input.workspaceId,
          type: input.type,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
        },
      },
    });
    if (alert === null) return null;
    if (alert.status === 'informational')
      return { alertId: alert.id, idempotent: true };
    if (alert.status === 'resolved' && input.ignoreAlreadyResolved === true) {
      return { alertId: alert.id, idempotent: true };
    }
    const resolvedAt = alert.resolvedAt ?? new Date();
    if (alert.status === 'active') {
      await tx.operationalAlert.update({
        where: { id: alert.id },
        data: {
          status: 'resolved',
          resolvedAt,
          resolutionReason: input.reason,
          resolvedByUserId: input.resolvedByUserId ?? null,
        },
      });
    } else if (alert.resolutionReason !== input.reason) {
      throw new OperationalAlertError('OPERATIONAL_ALERT_RESOLUTION_CONFLICT');
    }
    const recipientCount = await tx.notificationOutboxMessage.count({
      where: { alertId: alert.id },
    });
    const audit = await appendAuditEventTransactional(
      tx,
      new WorkspaceAuditTrailRepository(tx),
      {
        workspaceId: input.workspaceId,
        eventType: 'notification.alert.resolved',
        actor:
          input.resolvedByUserId === undefined
            ? { type: 'system', reason: 'automatic' }
            : { type: 'user', userId: input.resolvedByUserId },
        primaryEntity: { kind: 'operational_alert', id: alert.id },
        relatedEntities: [],
        occurredAt: resolvedAt.toISOString(),
        sourceId: `notification-alert-resolved:${alert.id}`,
        payload: {
          alertId: alert.id,
          alertType: alert.type,
          severity: alert.severity,
          sourceType: alert.sourceType,
          sourceId: alert.sourceId,
          recipientCount,
        },
      },
    );
    return { alertId: alert.id, idempotent: audit.idempotent };
  }
}
