import type { WorkflowDefinition } from '@tasktwin/workflow-schema';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkflowVersionDetailResponse } from '@/lib/control-plane-contracts';

const saveDraft = vi.hoisted(() => vi.fn());

vi.mock(
  '@/app/(authenticated)/workspaces/[workspaceId]/workflows/[workflowId]/versions/[versionId]/edit/actions',
  () => ({
    saveWorkflowDraftAction: saveDraft,
  }),
);

interface MockNode {
  id: string;
  data: { label: string; order: number; stepType: string };
}

vi.mock('@xyflow/react', () => ({
  Background: () => null,
  Controls: () => null,
  ReactFlow: ({
    nodes,
    edges,
    onNodeClick,
    children,
  }: {
    nodes: MockNode[];
    edges: unknown[];
    onNodeClick(event: { type: string }, node: MockNode): void;
    children: ReactNode;
  }) => (
    <div data-testid="react-flow" data-edge-count={edges.length}>
      {nodes.map((node) => (
        <button
          type="button"
          key={node.id}
          onClick={() => onNodeClick({ type: 'click' }, node)}
        >
          Step {node.data.order}: {node.data.stepType}, {node.data.label}
        </button>
      ))}
      {children}
    </div>
  ),
}));

import { WorkflowEditor } from '@/components/workflow-editor/workflow-editor';

function definition(): WorkflowDefinition {
  return {
    schemaVersion: 1,
    workflowId: 'workflow-session-11',
    version: 1,
    name: 'Editor workflow',
    status: 'draft',
    variables: [],
    steps: [
      {
        id: 'step-click',
        type: 'click',
        name: 'Click safely',
        locator: { kind: 'testId', value: 'safe-button' },
      },
      {
        id: 'step-wait',
        type: 'wait',
        name: 'Wait briefly',
        durationMs: 500,
      },
      {
        id: 'step-secret',
        type: 'fill',
        name: 'Use secret reference',
        locator: { kind: 'label', value: 'Credential' },
        value: { kind: 'secret', secretName: 'ACCOUNT_PASSWORD' },
      },
      {
        id: 'step-checked',
        type: 'setChecked',
        name: 'Enable option',
        locator: { kind: 'role', role: 'checkbox', name: 'Enable option' },
        checked: false,
      },
    ],
  };
}

function detail(
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' = 'MEMBER',
): WorkflowVersionDetailResponse {
  return {
    schemaVersion: 1,
    workspaceId: 'b1a44632-f0ec-4f9d-901f-69d3ae992c45',
    access: {
      role,
      canEdit: role !== 'VIEWER',
    },
    workflowVersion: {
      id: 'bd947ba1-c033-442f-93d8-2f895fd3c32b',
      workflowId: 'workflow-session-11',
      version: 1,
      revision: 1,
      status: 'draft',
      schemaVersion: 1,
      definition: definition(),
      updatedAt: '2026-07-29T20:00:00.000Z',
    },
    locatorMetadata: [
      {
        stepId: 'step-click',
        confidence: 'high',
        provenance: 'testId',
      },
    ],
  };
}

describe('WorkflowEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('31be5927-c067-421e-917d-bf533c934a0f')
      .mockReturnValueOnce('4a892223-8909-4d26-baa4-133da9c021a2');
  });

  it('renders one node per step and deterministic consecutive edges', () => {
    render(
      <WorkflowEditor detail={detail()} workspaceId={detail().workspaceId} />,
    );

    expect(
      within(screen.getByTestId('react-flow')).getAllByRole('button'),
    ).toHaveLength(4);
    expect(screen.getByTestId('react-flow')).toHaveAttribute(
      'data-edge-count',
      '3',
    );
  });

  it('selects, edits and reorders a step while showing dirty state', async () => {
    const user = userEvent.setup();
    render(
      <WorkflowEditor detail={detail()} workspaceId={detail().workspaceId} />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Step 2: wait, Wait briefly' }),
    );
    const name = screen.getByLabelText('Step name');
    await user.clear(name);
    await user.type(name, 'Updated wait');
    expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Move down' }));
    expect(
      screen.getByRole('button', { name: 'Step 3: wait, Updated wait' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Move up' }));
    expect(
      screen.getByRole('button', { name: 'Step 2: wait, Updated wait' }),
    ).toBeInTheDocument();
  });

  it('adds Wait and Approval and requires confirmation before deletion', async () => {
    const user = userEvent.setup();
    render(
      <WorkflowEditor detail={detail()} workspaceId={detail().workspaceId} />,
    );

    await user.click(screen.getByRole('button', { name: 'Add Wait' }));
    await user.click(screen.getByRole('button', { name: 'Add Approval' }));
    expect(
      within(screen.getByTestId('react-flow')).getAllByRole('button'),
    ).toHaveLength(6);

    await user.click(screen.getByRole('button', { name: 'Delete step' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete step' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete',
      }),
    );
    expect(
      within(screen.getByTestId('react-flow')).getAllByRole('button'),
    ).toHaveLength(5);
  });

  it('blocks an invalid duration and clears dirty state after a successful save', async () => {
    const user = userEvent.setup();
    saveDraft.mockImplementation(
      async (
        _versionId: string,
        _revision: number,
        savedDefinition: WorkflowDefinition,
      ) => ({
        status: 'success',
        revision: 2,
        definition: savedDefinition,
        updatedAt: '2026-07-29T21:00:00.000Z',
      }),
    );
    render(
      <WorkflowEditor detail={detail()} workspaceId={detail().workspaceId} />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Step 2: wait, Wait briefly' }),
    );
    const duration = screen.getByLabelText('Duration (milliseconds)');
    fireEvent.change(duration, { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    expect(screen.getByText(/expected number to be >=1/)).toBeInTheDocument();

    fireEvent.change(duration, { target: { value: '750' } });
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(
      await screen.findByText('Draft saved at revision 2.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Draft revision 2 · Saved/)).toBeInTheDocument();
  });

  it('preserves local changes on conflict and disables every edit for VIEWER', async () => {
    const user = userEvent.setup();
    saveDraft.mockResolvedValue({
      status: 'conflict',
      currentRevision: 2,
      message:
        'This draft was saved elsewhere. Your local changes are still here.',
    });
    const view = render(
      <WorkflowEditor detail={detail()} workspaceId={detail().workspaceId} />,
    );

    const workflowName = screen.getByLabelText('Workflow name');
    await user.clear(workflowName);
    await user.type(workflowName, 'My local conflict copy');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText(/saved elsewhere/)).toBeInTheDocument();
    expect(screen.getByLabelText('Workflow name')).toHaveValue(
      'My local conflict copy',
    );

    view.unmount();
    render(
      <WorkflowEditor
        detail={detail('VIEWER')}
        workspaceId={detail().workspaceId}
      />,
    );
    expect(screen.getByText(/read-only access/)).toBeInTheDocument();
    expect(screen.getByLabelText('Workflow name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();

    await user.click(
      screen.getByRole('button', {
        name: 'Step 3: fill, Use secret reference',
      }),
    );
    expect(
      screen.getByText(/Secret value is never displayed/),
    ).toBeInTheDocument();
    expect(
      screen.queryByDisplayValue('plaintext-secret'),
    ).not.toBeInTheDocument();
  });
});
