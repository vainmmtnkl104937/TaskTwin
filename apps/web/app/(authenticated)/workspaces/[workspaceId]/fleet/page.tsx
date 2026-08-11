import Link from 'next/link';
import { redirect } from 'next/navigation';

import { WorkspaceNav } from '@/components/workspace-nav';
import { getAccessToken } from '@/lib/server/auth-session';
import { listRunnerDevices } from '@/lib/server/control-plane';

export default async function FleetPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const token = await getAccessToken();
  if (token === null) redirect('/login');
  const fleet = await listRunnerDevices(token, workspaceId);

  return (
    <main className="dashboard-page">
      <Link href="/workspaces">Workspaces</Link>
      <WorkspaceNav workspaceId={workspaceId} currentPage="fleet" />
      <section className="page-heading">
        <p className="eyebrow">Declarative software state</p>
        <h1>Runner Fleet</h1>
        <p>
          Actual identity comes from authenticated heartbeats. Desired version
          is metadata only; software changes continue through the local Runner
          maintenance workflow.
        </p>
      </section>
      <section className="workflow-list" aria-label="Runner Fleet">
        {fleet.devices.map((device) => (
          <article className="panel workflow-list-item" key={device.id}>
            <h2>{device.metadata.displayName}</h2>
            <dl>
              <div>
                <dt>Actual version</dt>
                <dd>{device.softwareIdentity?.version ?? 'Unknown'}</dd>
              </div>
              <div>
                <dt>Desired version</dt>
                <dd>{device.desiredVersion ?? 'Not assigned'}</dd>
              </div>
              <div>
                <dt>Compliance</dt>
                <dd>{label(device.complianceStatus ?? 'unknown')}</dd>
              </div>
              <div>
                <dt>Connection</dt>
                <dd>{label(device.connectionStatus)}</dd>
              </div>
              <div>
                <dt>Runtime</dt>
                <dd>{label(device.runtime?.runtimeMode ?? 'unknown')}</dd>
              </div>
              <div>
                <dt>Service state</dt>
                <dd>{label(device.runtime?.serviceStatus ?? 'unknown')}</dd>
              </div>
            </dl>
          </article>
        ))}
        {fleet.devices.length === 0 ? (
          <p className="empty-state">
            No Runner is paired with this Workspace.
          </p>
        ) : null}
      </section>
    </main>
  );
}

function label(value: string): string {
  return value.replaceAll('_', ' ');
}
