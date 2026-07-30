import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  action: vi.fn(),
  state: {
    status: 'ready' as const,
    userCode: 'ABCD-EFGH-JKMP',
    inspection: {
      schemaVersion: 1 as const,
      pairingSessionId: '74120715-f13a-4463-ae17-82fe71312a16',
      status: 'PENDING' as const,
      metadata: {
        displayName: 'Safe Runner',
        platform: 'win32' as const,
        architecture: 'x64' as const,
        runnerVersion: '0.1.0',
        installationId: '4df9107c-c0fc-4613-9c40-a65640af4149',
      },
      expiresAt: '2026-07-30T12:10:00.000Z',
    },
  },
}));

vi.mock('react', async (importOriginal) => {
  const original = await importOriginal<typeof import('react')>();
  return {
    ...original,
    useActionState: () => [mocks.state, mocks.action, false],
  };
});

vi.mock('@/app/(authenticated)/runner-pairing/actions', () => ({
  runnerPairingAction: mocks.action,
}));

import { RunnerPairingForm } from '@/app/(authenticated)/runner-pairing/runner-pairing-form';

describe('runner pairing management UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders only manageable workspaces and safe device metadata', () => {
    render(
      <RunnerPairingForm
        workspaces={[
          {
            id: 'ad8ca9d9-648e-47c5-8443-408a1308315d',
            organizationId: '7309c270-e885-4149-a642-f98cb529f56f',
            name: 'Owner workspace',
            slug: 'owner',
            createdAt: '2026-07-30T12:00:00.000Z',
            updatedAt: '2026-07-30T12:00:00.000Z',
            role: 'OWNER',
            canManageRunners: true,
          },
          {
            id: '1b55ddd8-7453-4a88-9bd9-dcb77f372353',
            organizationId: '7309c270-e885-4149-a642-f98cb529f56f',
            name: 'Member workspace',
            slug: 'member',
            createdAt: '2026-07-30T12:00:00.000Z',
            updatedAt: '2026-07-30T12:00:00.000Z',
            role: 'MEMBER',
            canManageRunners: false,
          },
        ]}
      />,
    );

    expect(screen.getByText('Safe Runner')).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Owner workspace' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'Member workspace' }),
    ).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('credential');
    expect(document.body.textContent).not.toContain('digest');
  });
});
