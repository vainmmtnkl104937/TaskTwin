import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { CreateDraftButton } from '@/components/workflow-lifecycle/create-draft-button';
import { LifecycleStatusBadge } from '@/components/workflow-lifecycle/lifecycle-status-badge';
import { getAccessToken } from '@/lib/server/auth-session';
import {
  ControlPlaneError,
  listWorkflowVersions,
} from '@/lib/server/control-plane';

export default async function WorkflowVersionHistoryPage({
  params,
}: {
  params: Promise<{ workspaceId: string; workflowId: string }>;
}) {
  const { workspaceId, workflowId } = await params;
  const accessToken = await getAccessToken();
  if (accessToken === null) {
    redirect('/login');
  }

  let history;
  try {
    history = await listWorkflowVersions(accessToken, workflowId);
  } catch (error: unknown) {
    if (error instanceof ControlPlaneError && error.status === 401) {
      redirect('/auth/expired');
    }
    if (error instanceof ControlPlaneError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  if (
    history.workspaceId !== workspaceId ||
    history.workflowId !== workflowId
  ) {
    notFound();
  }

  return (
    <main className="dashboard-page">
      <nav aria-label="Breadcrumb">
        <Link href={`/workspaces/${workspaceId}/workflows`}>Workflows</Link>
      </nav>
      <section className="page-heading">
        <p className="eyebrow">Deterministic version lifecycle</p>
        <h1>Version history</h1>
        <p>
          Role: {history.access.role}. Published versions remain immutable;
          create a new Draft for future edits.
        </p>
      </section>
      <section className="workflow-list" aria-label="Workflow version history">
        {history.versions.map((version) => (
          <article className="panel workflow-list-item" key={version.id}>
            <div>
              <h2>Version {version.version}</h2>
              <p className="metadata">
                Revision {version.revision} ·{' '}
                <LifecycleStatusBadge status={version.status} />
              </p>
              <p className="metadata">
                Created{' '}
                <time dateTime={version.createdAt}>{version.createdAt}</time>
              </p>
              {version.createdFromVersionId === null ? null : (
                <p className="metadata">
                  Cloned from version ID {version.createdFromVersionId}
                </p>
              )}
            </div>
            <div className="button-group">
              <Link
                className="button-link"
                href={`/workspaces/${workspaceId}/workflows/${encodeURIComponent(workflowId)}/versions/${version.id}/edit`}
              >
                {version.status === 'draft' && history.access.canEdit
                  ? 'Open Draft'
                  : 'View'}
              </Link>
              {(version.status === 'published' ||
                version.status === 'archived') &&
              history.access.canEdit ? (
                <CreateDraftButton
                  workflowId={workflowId}
                  workspaceId={workspaceId}
                  sourceVersionId={version.id}
                />
              ) : null}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
