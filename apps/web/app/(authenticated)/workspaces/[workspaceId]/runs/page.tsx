import Link from 'next/link';
import { redirect } from 'next/navigation';

import { WorkflowRunStatusBadge } from '@/components/workflow-runs/workflow-run-status-badge';
import { getAccessToken } from '@/lib/server/auth-session';
import { listWorkflowRuns } from '@/lib/server/control-plane';

export default async function WorkflowRunsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const token = await getAccessToken();
  if (token === null) {
    redirect('/login');
  }
  const result = await listWorkflowRuns(token, workspaceId);
  return (
    <main className="dashboard-page">
      <nav aria-label="Breadcrumb">
        <Link href={`/workspaces/${workspaceId}/workflows`}>Workflows</Link>
        {' · '}
        <Link href={`/workspaces/${workspaceId}/approvals`}>
          Approval Center
        </Link>
        {' · '}
        <Link href={`/workspaces/${workspaceId}/repairs`}>Repair Center</Link>
      </nav>
      <section className="page-heading">
        <p className="eyebrow">Local execution</p>
        <h1>Workflow runs</h1>
        <p>Role: {result.access.role}</p>
      </section>
      <section className="workflow-list" aria-label="Workflow run history">
        {result.runs.map((run) => (
          <article className="panel workflow-list-item" key={run.id}>
            <div>
              <h2>Workflow version {run.workflowVersion}</h2>
              <p className="metadata">
                <WorkflowRunStatusBadge status={run.status} /> · {run.stepCount}{' '}
                steps
              </p>
            </div>
            <Link
              className="button-link"
              href={`/workspaces/${workspaceId}/runs/${run.id}`}
            >
              View run
            </Link>
          </article>
        ))}
        {result.runs.length === 0 ? (
          <p className="empty-state">No workflow run exists.</p>
        ) : null}
      </section>
    </main>
  );
}
