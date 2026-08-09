import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAccessToken } from '@/lib/server/auth-session';
import {
  ControlPlaneError,
  listRunnerDevices,
} from '@/lib/server/control-plane';

import { RevokeRunnerButton } from './revoke-runner-button';
import { RunnerSoftwareDetails } from './runner-software-details';

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
              <RunnerSoftwareDetails device={device} />
              <section aria-label="Runner runtime">
                <h3>Runtime</h3>
                {device.runtime ? (
                  <dl>
                    <div>
                      <dt>Mode</dt>
                      <dd>{runtimeModeLabel(device.runtime.runtimeMode)}</dd>
                    </div>
                    <div>
                      <dt>Service status</dt>
                      <dd>{labelWords(device.runtime.serviceStatus)}</dd>
                    </div>
                    <div>
                      <dt>Autonomy</dt>
                      <dd>{labelWords(device.runtime.autonomyLevel)}</dd>
                    </div>
                    <div>
                      <dt>Secret unlock</dt>
                      <dd>
                        {secretUnlockLabel(device.runtime.secretUnlockMode)}
                      </dd>
                    </div>
                    <div>
                      <dt>Scheduled execution</dt>
                      <dd>
                        {device.capabilities.includes('scheduled_execution_v1')
                          ? 'Available'
                          : 'Unavailable'}
                      </dd>
                    </div>
                    <div>
                      <dt>Restart resilience</dt>
                      <dd>
                        {device.runtime.restartResilient
                          ? 'Available after reboot'
                          : 'Process lifetime only'}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p>
                    Runtime metadata has not been reported by this Runner
                    version.
                  </p>
                )}
              </section>
              <section aria-label="Local Secret Store status">
                <h3>Local Secret Store</h3>
                {device.localSecretStore ? (
                  <>
                    <p>
                      Status: {device.localSecretStore.status} · Revision:{' '}
                      {device.localSecretStore.vaultRevision ?? 'none'} ·
                      Configured aliases:{' '}
                      {device.localSecretStore.configuredSecretCount}
                    </p>
                    <p className="metadata">
                      Last inventory sync:{' '}
                      {device.localSecretStore.lastSynchronizedAt ?? 'Never'}
                    </p>
                    {device.localSecretStore.aliases.length > 0 ? (
                      <ul aria-label="Configured secret aliases">
                        {device.localSecretStore.aliases.map((entry) => (
                          <li key={entry.secretVersionId}>{entry.alias}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>No aliases are configured.</p>
                    )}
                  </>
                ) : (
                  <p>
                    Unavailable. Configure locally with runner secrets init.
                  </p>
                )}
              </section>
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

function runtimeModeLabel(
  mode: 'interactive' | 'unattended_process' | 'service',
): string {
  switch (mode) {
    case 'interactive':
      return 'Interactive';
    case 'unattended_process':
      return 'Unattended Process';
    case 'service':
      return 'Service mode';
  }
}

function secretUnlockLabel(mode: 'none' | 'manual' | 'os_native'): string {
  switch (mode) {
    case 'none':
      return 'Unavailable';
    case 'manual':
      return 'Manual';
    case 'os_native':
      return 'OS-native';
  }
}

function labelWords(value: string): string {
  const words = value.replaceAll('_', ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}
