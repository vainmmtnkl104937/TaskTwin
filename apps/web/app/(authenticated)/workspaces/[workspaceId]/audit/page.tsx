import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAccessToken } from '@/lib/server/auth-session';
import { listAuditEvents } from '@/lib/server/control-plane';

import { AuditListClient } from './audit-list-client';

interface AuditListPageProps {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function readString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

function readStringList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string' && value.length > 0) {
    return value.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export default async function AuditListPage({
  params,
  searchParams,
}: AuditListPageProps) {
  const { workspaceId } = await params;
  const token = await getAccessToken();
  if (token === null) {
    redirect('/login');
  }
  const sp = await searchParams;
  const eventTypesList = readStringList(sp.eventTypes);
  const actorKindsList = readStringList(sp.actorKinds);
  const primaryEntityKind = readString(sp.primaryEntityKind);
  const primaryEntityId = readString(sp.primaryEntityId);
  const correlationId = readString(sp.correlationId);
  const fromOccurredAt = readString(sp.fromOccurredAt);
  const toOccurredAt = readString(sp.toOccurredAt);
  const fromSequence = readString(sp.fromSequence);
  const toSequence = readString(sp.toSequence);
  const result = await listAuditEvents(token, workspaceId, {
    ...(eventTypesList.length > 0 ? { eventTypes: eventTypesList } : {}),
    ...(actorKindsList.length > 0
      ? { actorKinds: actorKindsList as ('user' | 'runner' | 'system')[] }
      : {}),
    ...(primaryEntityKind ? { primaryEntityKind } : {}),
    ...(primaryEntityId ? { primaryEntityId } : {}),
    ...(correlationId ? { correlationId } : {}),
    ...(fromOccurredAt ? { fromOccurredAt } : {}),
    ...(toOccurredAt ? { toOccurredAt } : {}),
    ...(fromSequence ? { fromSequence: Number(fromSequence) } : {}),
    ...(toSequence ? { toSequence: Number(toSequence) } : {}),
  });
  return (
    <main className="dashboard-page">
      <nav aria-label="Breadcrumb">
        <Link href={`/workspaces/${workspaceId}/runs`}>Workflow runs</Link>
        {' · '}
        <Link href={`/workspaces/${workspaceId}/audit/verify`}>Verify chain</Link>
      </nav>
      <section className="page-heading">
        <p className="eyebrow">Append-only history</p>
        <h1>Audit trail</h1>
      </section>
      <AuditListClient
        accessToken={token}
        workspaceId={workspaceId}
        initialEvents={result.events}
        initialNextCursor={result.nextCursor}
        initialFilters={{
          eventTypes: eventTypesList,
          actorKinds: actorKindsList,
          primaryEntityKind,
          primaryEntityId,
          correlationId,
          fromOccurredAt,
          toOccurredAt,
          fromSequence,
          toSequence,
        }}
      />
    </main>
  );
}