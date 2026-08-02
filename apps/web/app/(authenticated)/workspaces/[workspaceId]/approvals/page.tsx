import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAccessToken } from '@/lib/server/auth-session';
import { listApprovalRequests } from '@/lib/server/control-plane';

import { ApprovalDecisionButtons } from './approval-decision-buttons';

export default async function ApprovalCenterPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const token = await getAccessToken();
  if (token === null) redirect('/login');
  const result = await listApprovalRequests(token, workspaceId);
  return (
    <main className="dashboard-page">
      <nav aria-label="Breadcrumb">
        <Link href={`/workspaces/${workspaceId}/runs`}>Workflow runs</Link>
      </nav>
      <section className="page-heading">
        <p className="eyebrow">Human review</p>
        <h1>Approval Center</h1>
        <p>Only safe workflow and step metadata is shown.</p>
      </section>
      <section className="workflow-list" aria-label="Approval requests">
        {result.requests.map((request) => (
          <article className="panel workflow-list-item" key={request.id}>
            <div>
              <h2>{request.workflowName}</h2>
              <p className="metadata">
                Version {request.workflowVersion} · {request.status} ·{' '}
                {request.riskLevel} risk
              </p>
              <p>{request.approvalStep.message}</p>
              <p className="metadata">
                Next step: {request.gatedStep.name} ({request.gatedStep.type})
              </p>
              <p className="metadata">
                Expires: {new Date(request.expiresAt).toLocaleString()}
              </p>
              <Link href={`/workspaces/${workspaceId}/approvals/${request.id}`}>
                View approval
              </Link>
            </div>
            {result.access.canDecide && request.status === 'PENDING' ? (
              <ApprovalDecisionButtons
                workspaceId={workspaceId}
                approvalRequestId={request.id}
              />
            ) : null}
          </article>
        ))}
        {result.requests.length === 0 ? (
          <p className="empty-state">No approval request exists.</p>
        ) : null}
      </section>
    </main>
  );
}
