import Link from 'next/link';
import { redirect } from 'next/navigation';

import { WorkspaceWelcomeChecklist } from '@/components/workspace-welcome-checklist';
import { getAccessToken } from '@/lib/server/auth-session';
import { ControlPlaneError, listWorkspaces } from '@/lib/server/control-plane';

export default async function WorkspacesPage() {
  const accessToken = await getAccessToken();
  if (accessToken === null) {
    redirect('/login');
  }

  let result;
  try {
    result = await listWorkspaces(accessToken);
  } catch (error: unknown) {
    if (error instanceof ControlPlaneError && error.status === 401) {
      redirect('/auth/expired');
    }
    throw error;
  }

  const firstWorkspace = result.workspaces[0];

  return (
    <main className="dashboard-page">
      <section className="page-heading">
        <p className="eyebrow">Control Plane</p>
        <h1>Workspaces</h1>
        <p>Select a workspace to review its workflows.</p>
        {result.workspaces.some((workspace) => workspace.canManageRunners) ? (
          <Link className="button-link" href="/runner-pairing">
            Pair a Local Runner
          </Link>
        ) : null}
      </section>
      {firstWorkspace !== undefined ? (
        <WorkspaceWelcomeChecklist
          workspace={{
            id: firstWorkspace.id,
            canManageRunners: firstWorkspace.canManageRunners,
          }}
        />
      ) : null}
      <section className="card-grid" aria-label="Available workspaces">
        {result.workspaces.map((workspace) => (
          <Link
            className="panel list-card"
            href={`/workspaces/${workspace.id}/workflows`}
            key={workspace.id}
          >
            <h2>{workspace.name}</h2>
            <p>{workspace.slug}</p>
            <p className="metadata">
              Role: {workspace.role} ·{' '}
              {workspace.canManageRunners
                ? 'Runner management enabled'
                : 'Runner management read only'}
            </p>
          </Link>
        ))}
        {result.workspaces.length === 0 ? (
          <p className="empty-state">No workspace is available.</p>
        ) : null}
      </section>
    </main>
  );
}
