import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getAccessToken } from '@/lib/server/auth-session';
import { getRepairRequest } from '@/lib/server/control-plane';

import { RepairDecisionButtons } from '../repair-decision-buttons';

export default async function RepairDetailPage({
  params,
}: {
  params: Promise<{ workspaceId: string; repairRequestId: string }>;
}) {
  const { workspaceId, repairRequestId } = await params;
  const token = await getAccessToken();
  if (token === null) redirect('/login');
  const result = await getRepairRequest(token, repairRequestId);
  if (result.request.workspaceId !== workspaceId) notFound();
  const request = result.request;
  return (
    <main className="dashboard-page">
      <nav aria-label="Breadcrumb">
        <Link href={`/workspaces/${workspaceId}/repairs`}>Repair Center</Link>
      </nav>
      <section className="page-heading">
        <p className="eyebrow">Safe recovery metadata</p>
        <h1>{request.step.name}</h1>
        <p>
          {request.workflowName} · Version {request.workflowVersion}
        </p>
      </section>
      <section className="panel">
        <p>Status: {request.status}</p>
        <p>Step type: {request.step.type}</p>
        <p>Attempt: {request.attemptNumber}</p>
        <p>Safe error code: {request.safeErrorCode}</p>
        <p>Effect certainty: {request.effectCertainty}</p>
        <p>Runner: {request.runner.name}</p>
        <p>Expires: {new Date(request.expiresAt).toLocaleString()}</p>
        <p className="metadata">
          Runtime values, locators, full URLs and raw browser errors are never
          shown here. Manual browser changes are not fully audited.
        </p>
        {request.status === 'PENDING' ? (
          <RepairDecisionButtons
            workspaceId={workspaceId}
            repairRequestId={request.id}
            canRetry={result.access.canRetry}
            canAbort={result.access.canAbort}
            retryAllowed={request.retryAllowed}
          />
        ) : null}
      </section>
    </main>
  );
}
