import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getRunEvidence } = vi.hoisted(() => ({
  getRunEvidence: vi.fn(),
}));

vi.mock('@/lib/server/control-plane', () => ({
  getRunEvidence,
}));

import { RunEvidenceList } from '@/components/workflow-runs/run-evidence-list';

describe('RunEvidenceList', () => {
  beforeEach(() => {
    getRunEvidence.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders typed safe evidence events without forbidden keys', async () => {
    getRunEvidence.mockResolvedValueOnce({
      schemaVersion: 1,
      workspaceId: '00000000-0000-4000-8000-000000000099',
      workflowRunId: '00000000-0000-4000-8000-000000000010',
      events: [
        {
          id: '00000000-0000-4000-8000-000000000011',
          sequence: 12,
          eventType: 'workflow_run.created',
          actor: {
            type: 'user',
            userId: '00000000-0000-4000-8000-000000000012',
          },
          primaryEntity: { kind: 'workflow_run', id: 'run-1' },
          occurredAt: '2026-08-06T01:00:00.000Z',
          payload: {
            schemaVersion: 1,
            workflowRunId: 'run-1',
            workflowVersionId: 'version-1',
          },
        },
      ],
    });
    render(
      <RunEvidenceList
        accessToken="token"
        workflowRunId="00000000-0000-4000-8000-000000000010"
      />,
    );
    await waitFor(() => {
      expect(
        screen.getByText(/workflow_run\.created/),
      ).toBeInTheDocument();
    });
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('observed');
    expect(body).not.toContain('expected');
    expect(body).not.toContain('password');
    expect(body).not.toContain('token');
  });

  it('shows empty state when no evidence exists', async () => {
    getRunEvidence.mockResolvedValueOnce({
      schemaVersion: 1,
      workspaceId: '00000000-0000-4000-8000-000000000099',
      workflowRunId: '00000000-0000-4000-8000-000000000010',
      events: [],
    });
    render(
      <RunEvidenceList
        accessToken="token"
        workflowRunId="00000000-0000-4000-8000-000000000010"
      />,
    );
    await waitFor(() => {
      expect(
        screen.getByText(/No audit events were recorded/),
      ).toBeInTheDocument();
    });
  });

  it('surfaces control-plane errors safely', async () => {
    getRunEvidence.mockRejectedValueOnce(new Error('Boom'));
    render(
      <RunEvidenceList
        accessToken="token"
        workflowRunId="00000000-0000-4000-8000-000000000010"
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Boom');
    });
  });
});