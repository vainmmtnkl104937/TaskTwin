import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AuditEventDetail } from '@/components/audit-trail/audit-event-detail';
import { getAccessToken } from '@/lib/server/auth-session';
import { ControlPlaneError, getAuditEvent } from '@/lib/server/control-plane';

interface AuditEventDetailPageProps {
  params: Promise<{ workspaceId: string; auditEventId: string }>;
}

export default async function AuditEventDetailPage({
  params,
}: AuditEventDetailPageProps) {
  const { workspaceId, auditEventId } = await params;
  const token = await getAccessToken();
  if (token === null) {
    redirect('/login');
  }
  let result;
  try {
    result = await getAuditEvent(token, auditEventId);
  } catch (error: unknown) {
    if (error instanceof ControlPlaneError && error.status === 404) {
      notFound();
    }
    throw error;
  }
  if (result.event.workspaceId !== workspaceId) {
    notFound();
  }
  return (
    <main className="dashboard-page">
      <nav aria-label="Breadcrumb">
        <Link href={`/workspaces/${workspaceId}/audit`}>Audit trail</Link>
      </nav>
      <AuditEventDetail event={result.event} />
    </main>
  );
}