import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  redirect: vi.fn(),
}));

vi.mock('@/components/schedules/schedule-actions', () => ({
  createWorkflowScheduleAction: vi.fn(),
}));

vi.mock('@/lib/server/auth-session', () => ({
  getAccessToken: vi.fn(async () => 'safe-access-token'),
}));

vi.mock('@/lib/server/control-plane', () => ({
  ControlPlaneError: class ControlPlaneError extends Error {},
  listRunnerDevices: vi.fn(async () => ({
    schemaVersion: 1,
    workspaceId: '4a040f4b-c184-4023-8f09-55eea37b72b8',
    access: { role: 'OWNER', canManage: true },
    devices: [
      {
        id: '1f7fbc2b-ebae-44bc-8ff7-1ab41458d13d',
        workspaceId: '4a040f4b-c184-4023-8f09-55eea37b72b8',
        metadata: {
          displayName: 'Safe Local Runner',
          platform: 'linux',
          architecture: 'x64',
          runnerVersion: '0.1.0',
          installationId: 'b95243b1-ae72-4c05-9c2e-f0030f5fca03',
        },
        capabilities: ['scheduled_execution_v1', 'local_secret_store_v1'],
        runtime: {
          schemaVersion: 1,
          runtimeMode: 'service',
          autonomyLevel: 'boot_resilient',
          serviceStatus: 'running',
          secretUnlockMode: 'os_native',
          restartResilient: true,
          runtimeMetadataRevision: 3,
        },
        connectionStatus: 'online',
        lastSeenAt: '2026-08-09T00:00:00.000Z',
        revokedAt: null,
        createdAt: '2026-08-09T00:00:00.000Z',
        localSecretStore: {
          status: 'ready',
          vaultRevision: 4,
          configuredSecretCount: 1,
          lastSynchronizedAt: '2026-08-09T00:00:00.000Z',
          aliases: [
            {
              alias: 'LOGIN_PASSWORD',
              secretVersionId: '1d5c31be-17c5-4f6a-b048-dae32a0f16d0',
            },
          ],
        },
      },
    ],
  })),
}));

import RunnerDevicesPage from '@/app/(authenticated)/workspaces/[workspaceId]/runner-devices/page';
import { CreateScheduleDialog } from '@/components/schedules/create-schedule-dialog';

describe('Local Secret Store Web metadata', () => {
  it('renders Runner status and aliases without secret values or reveal controls', async () => {
    render(
      await RunnerDevicesPage({
        params: Promise.resolve({
          workspaceId: '4a040f4b-c184-4023-8f09-55eea37b72b8',
        }),
      }),
    );
    expect(screen.getByRole('heading', { name: 'Local Secret Store' })).toBeInTheDocument();
    expect(screen.getByText('LOGIN_PASSWORD')).toBeInTheDocument();
    expect(screen.getByText('Service mode')).toBeInTheDocument();
    expect(screen.getByText('Boot resilient')).toBeInTheDocument();
    expect(screen.getByText('OS-native')).toBeInTheDocument();
    expect(screen.getByText('Available after reboot')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('WEB_SECRET_VALUE_29');
    expect(screen.queryByRole('button', { name: /reveal/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /install service/i })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('NT AUTHORITY');
    expect(document.body.textContent).not.toContain('protectedKey');
  });

  it('shows required alias availability and local-only missing guidance', () => {
    render(
      <CreateScheduleDialog
        initialWorkflows={[{
          id: 'workflow-1',
          name: 'Login safely',
          versionId: '57346822-3b14-447c-9bdc-623d3fc3bf8b',
          version: 1,
          requiredSecretAliases: ['LOGIN_PASSWORD', 'MISSING_SECRET'],
        }]}
        initialRunners={[{
          id: '1f7fbc2b-ebae-44bc-8ff7-1ab41458d13d',
          name: 'Safe Local Runner',
          status: 'online',
          localSecretStore: {
            status: 'ready',
            configuredSecretCount: 1,
            aliases: [{ alias: 'LOGIN_PASSWORD',
              secretVersionId: '1d5c31be-17c5-4f6a-b048-dae32a0f16d0' }],
          },
        }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }));
    expect(screen.getByText('LOGIN_PASSWORD: available')).toBeInTheDocument();
    expect(screen.getByText('MISSING_SECRET: missing')).toBeInTheDocument();
    expect(screen.getByText(/runner secrets set/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/secret value/i)).not.toBeInTheDocument();
  });
});
