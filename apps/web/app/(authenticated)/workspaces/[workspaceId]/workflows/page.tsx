import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAccessToken } from '@/lib/server/auth-session';
import { ControlPlaneError, listWorkflows } from '@/lib/server/control-plane';

export default async function WorkflowsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const accessToken = await getAccessToken();
  if (accessToken === null) {
    redirect('/login');
  }

  let result;
  try {
    result = await listWorkflows(accessToken, workspaceId);
  } catch (error: unknown) {
    if (error instanceof ControlPlaneError && error.status === 401) {
      redirect('/auth/expired');
    }
    throw error;
  }

  return (
    <main className="dashboard-page">
      <nav aria-label="Breadcrumb">
        <Link href="/workspaces">Workspaces</Link>
      </nav>
      <section className="page-heading">
        <p className="eyebrow">Workspace workflows</p>
        <h1>Workflows</h1>
        <p>
          Role: {result.access.role}.{' '}
          {result.access.canEdit ? 'Draft editing enabled.' : 'Read only.'}
        </p>
        <Link className="button-link" href={`/workspaces/${workspaceId}/runs`}>
          Workflow runs
        </Link>
      </section>
      <section className="workflow-list" aria-label="Available workflows">
        {result.workflows.map((workflow) => (
          <article className="panel workflow-list-item" key={workflow.id}>
            <div>
              <h2>{workflow.name}</h2>
              <p>{workflow.description ?? 'No description'}</p>
              <p className="metadata">
                Version {workflow.version} · Revision {workflow.revision} ·{' '}
                {workflow.status}
              </p>
            </div>
            <div className="button-group">
              <Link
                className="button-link"
                href={`/workspaces/${workspaceId}/workflows/${encodeURIComponent(workflow.id)}/versions`}
              >
                Version history
              </Link>
              <Link
                className="button-link"
                href={`/workspaces/${workspaceId}/workflows/${encodeURIComponent(workflow.id)}/versions/${workflow.latestVersionId}/edit`}
              >
                {workflow.status === 'draft' && result.access.canEdit
                  ? 'Edit draft'
                  : 'View'}
              </Link>
            </div>
          </article>
        ))}
        {result.workflows.length === 0 ? (
          <p className="empty-state">No workflow version is available.</p>
        ) : null}
      </section>
    </main>
  );
}
