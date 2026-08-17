import Link from 'next/link';

import { listRunnerDevices } from '@/lib/server/control-plane';
import { getAccessToken } from '@/lib/server/auth-session';

interface WorkspaceSummary {
  id: string;
  canManageRunners: boolean;
}

type LocalSecretStoreSummary = {
  status: string;
  configuredSecretCount: number;
};

type RunnerDeviceSummary = {
  id: string;
  connectionStatus: string;
  localSecretStore?: LocalSecretStoreSummary | null;
};

async function safeListRunnerDevices(
  workspace: WorkspaceSummary,
): Promise<{ ok: true; devices: RunnerDeviceSummary[] } | { ok: false }> {
  const token = await getAccessToken();
  if (token === null) return { ok: false };
  try {
    const result = await listRunnerDevices(token, workspace.id);
    return {
      ok: true,
      devices: result.devices.map((device) => ({
        id: device.id,
        connectionStatus: device.connectionStatus,
        ...(device.localSecretStore !== undefined
          ? { localSecretStore: device.localSecretStore }
          : {}),
      })),
    };
  } catch {
    return { ok: false };
  }
}

export async function WorkspaceWelcomeChecklist({
  workspace,
}: {
  workspace: WorkspaceSummary;
}) {
  const runner = await safeListRunnerDevices(workspace);

  const extensionReady = true;
  let runnerReady = false;
  let secretStoreReady = false;
  if (runner.ok) {
    runnerReady = runner.devices.length > 0;
    secretStoreReady = runner.devices.some((device) => {
      const store = device.localSecretStore ?? null;
      return store !== null && store.configuredSecretCount > 0;
    });
  }

  return (
    <section
      className="panel welcome-checklist"
      aria-labelledby="welcome-checklist-heading"
    >
      <h2 id="welcome-checklist-heading">Get started</h2>
      <p className="metadata">
        Three steps before your first workflow. None send secret values to the
        Control Plane.
      </p>
      <ul className="welcome-checklist-items">
        <li>
          <span
            aria-hidden="true"
            className={`welcome-status ${extensionReady ? 'is-done' : 'is-todo'}`}
          >
            {extensionReady ? '✓' : '○'}
          </span>
          <div>
            <strong>Install the TaskTwin Chrome extension.</strong>
            <p className="metadata">
              Build the extension and load it unpacked from
              <code> apps/extension/dist</code>. See the{' '}
              <Link href="/runner-releases">trusted Runner releases</Link> page
              for the build instructions and{' '}
              <Link href="/runner-pairing">pair the Runner</Link> next.
            </p>
          </div>
        </li>
        <li>
          <span
            aria-hidden="true"
            className={`welcome-status ${runnerReady ? 'is-done' : 'is-todo'}`}
          >
            {runnerReady ? '✓' : '○'}
          </span>
          <div>
            <strong>Pair a Local Runner.</strong>
            <p className="metadata">
              On the Windows host run{' '}
              <code>runner pair --api-origin &lt;origin&gt;</code>, then
              {workspace.canManageRunners ? (
                <>
                  {' '}
                  approve the user code on{' '}
                  <Link href="/runner-pairing">/runner-pairing</Link>.
                </>
              ) : (
                ' ask a workspace admin to approve the pairing.'
              )}
            </p>
          </div>
        </li>
        <li>
          <span
            aria-hidden="true"
            className={`welcome-status ${secretStoreReady ? 'is-done' : 'is-todo'}`}
          >
            {secretStoreReady ? '✓' : '○'}
          </span>
          <div>
            <strong>Initialize the Local Secret Store.</strong>
            <p className="metadata">
              Only required when a scheduled run needs secret references. Run{' '}
              <code>runner secrets init</code> and{' '}
              <code>runner secrets set &lt;alias&gt;</code> on the Runner
              host. Values are prompted without echo and stay local.
            </p>
          </div>
        </li>
      </ul>
    </section>
  );
}