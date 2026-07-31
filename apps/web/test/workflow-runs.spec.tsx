import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/app/(authenticated)/workspaces/[workspaceId]/runs/actions', () => ({
  createWorkflowRunAction: vi.fn(),
  cancelWorkflowRunAction: vi.fn(),
}));

import { RunWorkflowPanel } from '@/components/workflow-runs/run-workflow-panel';
import { WorkflowRunStatusBadge } from '@/components/workflow-runs/workflow-run-status-badge';

describe('workflow run UI', () => {
  it('requires a runner and renders only safe runner metadata', () => {
    render(
      <RunWorkflowPanel
        workspaceId="af3bd244-5d28-4d5e-a8e4-5ab9eaf5d423"
        workflowVersionId="70c3c0d6-0fd7-4682-a0e4-675e13350947"
        runners={[
          {
            id: '215b770d-0566-42ad-8368-28db2cc2fd36',
            name: 'Office runner',
            status: 'online',
          },
        ]}
      />,
    );
    expect(screen.getByLabelText('Local Runner')).toHaveValue(
      '215b770d-0566-42ad-8368-28db2cc2fd36',
    );
    expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled();
    expect(document.body.textContent).not.toContain('lease');
    expect(document.body.textContent).not.toContain('credential');
  });

  it('renders a persisted terminal status without raw result data', () => {
    render(<WorkflowRunStatusBadge status="INTERRUPTED" />);
    expect(screen.getByText('INTERRUPTED')).toBeInTheDocument();
  });
});
