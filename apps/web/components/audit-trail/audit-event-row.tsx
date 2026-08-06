'use client';

import type { JSX } from 'react';
import type { SafeAuditEvent } from '../../lib/control-plane-contracts';

interface AuditEventRowProps {
  event: SafeAuditEvent;
  href: string;
}

function formatOccurredAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toISOString();
}

function formatActor(value: SafeAuditEvent['actor']): string {
  if (value.type === 'user') {
    return `user:${value.userId}`;
  }
  if (value.type === 'runner') {
    return `runner:${value.runnerDeviceId}`;
  }
  return `system:${value.reason}`;
}

export function AuditEventRow({ event, href }: AuditEventRowProps): JSX.Element {
  return (
    <tr>
      <td>
        <a href={href}>{event.sequence}</a>
      </td>
      <td>{formatOccurredAt(event.occurredAt)}</td>
      <td>{event.eventType}</td>
      <td>{formatActor(event.actor)}</td>
      <td>
        {event.primaryEntity.kind}:{event.primaryEntity.id}
      </td>
      <td>{event.correlationId}</td>
    </tr>
  );
}
