import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAccessToken } from '@/lib/server/auth-session';
import {
  ControlPlaneError,
  listRunnerDevices,
} from '@/lib/server/control-plane';

import { RevokeRunnerButton } from './revoke-runner-button';

export default async function RunnerDevicesPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const token = await getAccessToken();
  if (token === null) {
    redirect('/login');
  }
  let result;
  try {
    result = await listRunnerDevices(token, workspaceId);
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
        <p className="eyebrow">Local execution plane</p>
        <h1>Local Runners</h1>
        <p>
          Role: {result.access.role}. Online status is derived from the latest
          heartbeat.
        </p>
        {result.access.canManage ? (
          <Link className="button-link" href="/runner-pairing">
            Pair a runner
          </Link>
        ) : null}
      </section>
      <section className="workflow-list" aria-label="Local Runner devices">
        {result.devices.map((device) => (
          <article className="panel workflow-list-item" key={device.id}>
            <div>
              <h2>{device.metadata.displayName}</h2>
              <p>
                {device.metadata.platform} · {device.metadata.architecture} ·{' '}
                version {device.metadata.runnerVersion}
              </p>
              <p className="metadata">
                Status: {device.connectionStatus} · Last seen:{' '}
                {device.lastSeenAt ?? 'Never'}
              </p>
            </div>
            {result.access.canManage &&
            device.connectionStatus !== 'revoked' ? (
              <RevokeRunnerButton
                runnerDeviceId={device.id}
                workspaceId={workspaceId}
              />
            ) : null}
          </article>
        ))}
        {result.devices.length === 0 ? (
          <p className="empty-state">No Local Runner is paired.</p>
        ) : null}
      </section>
    </main>
  );
}
