import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RunnerSoftwareDetails } from '@/app/(authenticated)/workspaces/[workspaceId]/runner-devices/runner-software-details';

const baseDevice = {
  metadata: {
    platform: 'win32',
    architecture: 'x64',
    runnerVersion: '0.1.0',
  },
  softwareIdentity: {
    version: '0.1.0',
    runnerProtocolVersion: 2,
    workflowSchemaVersion: 1,
    localStateSchemaVersion: 1,
    platform: 'windows',
    architecture: 'x64',
  },
} as const;

describe('Runner software details', () => {
  it('renders an explicit update-required blocking state without remote controls', () => {
    render(
      <RunnerSoftwareDetails
        device={{
          ...baseDevice,
          compatibility: { status: 'update_required' },
        }}
      />,
    );

    expect(screen.getByText('Update required')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'New workflow jobs are blocked',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /update|rollback|download|install/i }),
    ).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/download-and-run/i);
  });

  it('renders unsupported software as a blocking state', () => {
    render(
      <RunnerSoftwareDetails
        device={{
          ...baseDevice,
          compatibility: { status: 'unsupported' },
        }}
      />,
    );

    expect(screen.getByText('Unsupported')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'incompatible with the Control Plane',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /update|rollback|download|install/i }),
    ).not.toBeInTheDocument();
  });
});
