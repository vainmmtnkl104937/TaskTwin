import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { deriveSecureRunInputManifest } from '@tasktwin/secure-run-inputs';

import { CreateDraftButton } from '@/components/workflow-lifecycle/create-draft-button';
import { LifecycleStatusBadge } from '@/components/workflow-lifecycle/lifecycle-status-badge';
import { getAccessToken } from '@/lib/server/auth-session';
import {
  ControlPlaneError,
  listRunnerDevices,
  listWorkflowVersions,
  getWorkflowVersion,
} from '@/lib/server/control-plane';
import { RunWorkflowPanel } from '@/components/workflow-runs/run-workflow-panel';

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
  let runners;
  try {
    history = await listWorkflowVersions(accessToken, workflowId);
    runners = await listRunnerDevices(accessToken, workspaceId);
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

  const runInputManifests = new Map(
    await Promise.all(
      history.versions
        .filter((version) => version.status === 'published')
        .map(async (version) => {
          const detail = await getWorkflowVersion(accessToken, version.id);
          return [
            version.id,
            deriveSecureRunInputManifest(detail.workflowVersion.definition),
          ] as const;
        }),
    ),
  );

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
              {version.status === 'published' ? (
                <RunWorkflowPanel
                  workspaceId={workspaceId}
                  workflowVersionId={version.id}
                  manifest={runInputManifests.get(version.id)!}
                  runners={runners.devices
                    .filter((device) => device.connectionStatus !== 'revoked')
                    .map((device) => ({
                      id: device.id,
                      name: device.metadata.displayName,
                      status: device.connectionStatus,
                      capabilities: device.capabilities,
                    }))}
                />
              ) : null}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
