import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAccessToken } from '@/lib/server/auth-session';
import { getApprovalRequest } from '@/lib/server/control-plane';

import { ApprovalDecisionButtons } from '../approval-decision-buttons';

export default async function ApprovalDetailPage({
  params,
}: {
  params: Promise<{ workspaceId: string; approvalRequestId: string }>;
}) {
  const { workspaceId, approvalRequestId } = await params;
  const token = await getAccessToken();
  if (token === null) redirect('/login');
  const result = await getApprovalRequest(token, approvalRequestId);
  const request = result.request;
  return (
    <main className="dashboard-page">
      <nav aria-label="Breadcrumb">
        <Link href={`/workspaces/${workspaceId}/approvals`}>
          Approval Center
        </Link>
      </nav>
      <section className="panel">
        <p className="eyebrow">{request.riskLevel} risk</p>
        <h1>{request.approvalStep.name}</h1>
        <p>{request.approvalStep.message}</p>
        <dl>
          <dt>Workflow</dt>
          <dd>
            {request.workflowName} · version {request.workflowVersion}
          </dd>
          <dt>Immediate next step</dt>
          <dd>
            {request.gatedStep.name} ({request.gatedStep.type})
          </dd>
          <dt>Status</dt>
          <dd>{request.status}</dd>
          <dt>Expires</dt>
          <dd>{new Date(request.expiresAt).toLocaleString()}</dd>
        </dl>
        {result.access.canDecide && request.status === 'PENDING' ? (
          <ApprovalDecisionButtons
            workspaceId={workspaceId}
            approvalRequestId={approvalRequestId}
          />
        ) : null}
      </section>
    </main>
  );
}
