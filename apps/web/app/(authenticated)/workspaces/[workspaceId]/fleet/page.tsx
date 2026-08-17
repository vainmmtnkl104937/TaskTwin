import Link from 'next/link';
import { redirect } from 'next/navigation';

import { WorkspaceNav } from '@/components/workspace-nav';
import { getAccessToken } from '@/lib/server/auth-session';
import { listRunnerDevices } from '@/lib/server/control-plane';
import { describeCompliance } from '@/lib/runner-rollout-labels';

const RUNTIME_MODE_LABEL: Record<string, string> = {
  interactive: 'Interactive CLI',
  service: 'Windows Service',
  unknown: 'Unknown',
};

const SERVICE_STATUS_LABEL: Record<string, string> = {
  installed: 'Service installed',
  stopped: 'Service stopped',
  starting: 'Service starting',
  running: 'Service running',
  stopping: 'Service stopping',
  unhealthy: 'Service unhealthy',
  uninstalled: 'Service not installed',
  unknown: 'Service status unknown',
};

const CONNECTION_LABEL: Record<string, string> = {
  online: 'Online',
  offline: 'Offline (no recent heartbeat)',
};

function describeLocalSecretStore(
  store:
    | {
        status: string;
        configuredSecretCount: number;
      }
    | null
    | undefined,
): string {
  if (store === null || store === undefined) return 'Not initialized';
  if (store.configuredSecretCount === 0) return 'Initialized, empty';
  return `Ready (${store.configuredSecretCount} alias${
    store.configuredSecretCount === 1 ? '' : 'es'
  })`;
}

export default async function FleetPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const token = await getAccessToken();
  if (token === null) redirect('/login');
  const fleet = await listRunnerDevices(token, workspaceId);

  const canManageRollouts = fleet.access.canManage;
  const hasRolloutsAvailable = fleet.devices.length > 0;

  let rolloutsHref: string | null = null;
  if (canManageRollouts) {
    rolloutsHref = `/workspaces/${workspaceId}/runner-rollouts`;
  }

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
        <div className="button-group">
          {rolloutsHref !== null ? (
            <Link className="button-link" href={rolloutsHref}>
              Open fleet rollouts
            </Link>
          ) : null}
          <Link className="button-link" href="/runner-releases">
            Browse trusted releases
          </Link>
        </div>
      </section>
      <section className="workflow-list" aria-label="Runner Fleet">
        {fleet.devices.map((device) => (
          <article className="panel workflow-list-item" key={device.id}>
            <h2>{device.metadata.displayName}</h2>
            <p className="metadata">
              Device ID: <code>{device.id.slice(0, 8)}…</code>
            </p>
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
                <dd>{describeCompliance(device.complianceStatus ?? 'unknown')}</dd>
              </div>
              <div>
                <dt>Connection</dt>
                <dd>{CONNECTION_LABEL[device.connectionStatus] ?? device.connectionStatus}</dd>
              </div>
              <div>
                <dt>Runtime</dt>
                <dd>
                  {RUNTIME_MODE_LABEL[device.runtime?.runtimeMode ?? 'unknown'] ??
                    device.runtime?.runtimeMode ??
                    'Unknown'}
                </dd>
              </div>
              <div>
                <dt>Service state</dt>
                <dd>
                  {SERVICE_STATUS_LABEL[device.runtime?.serviceStatus ?? 'unknown'] ??
                    device.runtime?.serviceStatus ??
                    'Unknown'}
                </dd>
              </div>
              <div>
                <dt>Local Secret Store</dt>
                <dd>{describeLocalSecretStore(device.localSecretStore)}</dd>
              </div>
            </dl>
          </article>
        ))}
        {fleet.devices.length === 0 ? (
          <p className="empty-state">
            No Runner is paired with this Workspace. Pair one from{' '}
            <Link href="/runner-pairing">/runner-pairing</Link> first; rollouts
            become available only after the Runner appears here.
            {!hasRolloutsAvailable && canManageRollouts ? (
              <>
                {' '}
                When pairing succeeds, the{' '}
                <em>Open fleet rollouts</em> button at the top of this page
                takes you to the rollout view.
              </>
            ) : null}
          </p>
        ) : null}
      </section>
    </main>
  );
}
