import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AuditVerifyButton } from '@/components/audit-trail/audit-verify-button';
import { getAccessToken } from '@/lib/server/auth-session';

interface AuditVerifyPageProps {
  params: Promise<{ workspaceId: string }>;
}

export default async function AuditVerifyPage({ params }: AuditVerifyPageProps) {
  const { workspaceId } = await params;
  const token = await getAccessToken();
  if (token === null) {
    redirect('/login');
  }
  return (
    <main className="dashboard-page">
      <nav aria-label="Breadcrumb">
        <Link href={`/workspaces/${workspaceId}/audit`}>Audit trail</Link>
      </nav>
      <section className="page-heading">
        <p className="eyebrow">Tamper detection</p>
        <h1>Verify audit chain</h1>
        <p>
          Re-hashes every audit event in the workspace and verifies that the chain
          is intact from the first event through the latest head.
        </p>
      </section>
      <AuditVerifyButton workspaceId={workspaceId} />
    </main>
  );
}