import Link from 'next/link';
import { redirect } from 'next/navigation';

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

  return (
    <main className="dashboard-page">
      <section className="page-heading">
        <p className="eyebrow">Control Plane</p>
        <h1>Workspaces</h1>
        <p>Select a workspace to review its workflows.</p>
      </section>
      <section className="card-grid" aria-label="Available workspaces">
        {result.workspaces.map((workspace) => (
          <Link
            className="panel list-card"
            href={`/workspaces/${workspace.id}/workflows`}
            key={workspace.id}
          >
            <h2>{workspace.name}</h2>
            <p>{workspace.slug}</p>
          </Link>
        ))}
        {result.workspaces.length === 0 ? (
          <p className="empty-state">No workspace is available.</p>
        ) : null}
      </section>
    </main>
  );
}
