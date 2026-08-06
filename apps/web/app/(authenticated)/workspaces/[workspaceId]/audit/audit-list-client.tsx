'use client';

import { useState } from 'react';
import type { JSX } from 'react';

import { AuditEventFilters } from '@/components/audit-trail/audit-event-filters';
import { AuditEventRow } from '@/components/audit-trail/audit-event-row';
import { listAuditEvents } from '@/lib/server/control-plane';
import type {
  AuditEventListResponse,
  SafeAuditEvent,
} from '@/lib/control-plane-contracts';

interface AuditListClientProps {
  accessToken: string;
  workspaceId: string;
  initialEvents: SafeAuditEvent[];
  initialNextCursor: AuditEventListResponse['nextCursor'];
  initialFilters: {
    eventTypes: string[];
    actorKinds: string[];
    primaryEntityKind: string;
    primaryEntityId: string;
    correlationId: string;
    fromOccurredAt: string;
    toOccurredAt: string;
    fromSequence: string;
    toSequence: string;
  };
}

export function AuditListClient({
  accessToken,
  workspaceId,
  initialEvents,
  initialNextCursor,
  initialFilters,
}: AuditListClientProps): JSX.Element {
  const [events, setEvents] = useState<SafeAuditEvent[]>(initialEvents);
  const [cursor, setCursor] = useState<AuditEventListResponse['nextCursor']>(initialNextCursor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function applyFilters(filters: Record<string, string | string[]>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await listAuditEvents(accessToken, workspaceId, filters);
      setEvents(result.events);
      setCursor(result.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  async function loadMore(): Promise<void> {
    if (cursor === null) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await listAuditEvents(accessToken, workspaceId, { cursor: cursor.encoded });
      setEvents((prev) => [...prev, ...result.events]);
      setCursor(result.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AuditEventFilters initial={initialFilters} onApply={applyFilters} />
      {error !== null ? <p role="alert">{error}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Sequence</th>
            <th>Occurred at</th>
            <th>Event type</th>
            <th>Actor</th>
            <th>Primary entity</th>
            <th>Correlation</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <AuditEventRow
              key={event.id}
              event={event}
              href={`/workspaces/${workspaceId}/audit/${event.id}`}
            />
          ))}
        </tbody>
      </table>
      {cursor !== null ? (
        <button type="button" onClick={loadMore} disabled={busy}>
          {busy ? 'Loading...' : 'Load more'}
        </button>
      ) : null}
    </>
  );
}