import type { WorkflowDefinition } from '@tasktwin/workflow-schema';
import { analyzePublishReadiness } from '@tasktwin/workflow-lifecycle';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkflowVersionDetailResponse } from '@/lib/control-plane-contracts';

const saveDraft = vi.hoisted(() => vi.fn());
const lifecycleAction = vi.hoisted(() => vi.fn());
const routerPush = vi.hoisted(() => vi.fn());
const routerRefresh = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPush,
    refresh: routerRefresh,
  }),
}));

vi.mock(
  '@/app/(authenticated)/workspaces/[workspaceId]/workflows/[workflowId]/versions/[versionId]/edit/actions',
  () => ({
    saveWorkflowDraftAction: saveDraft,
  }),
);

vi.mock(
  '@/app/(authenticated)/workspaces/[workspaceId]/workflows/[workflowId]/versions/actions',
  () => ({
    archiveVersionAction: lifecycleAction,
    createDraftVersionAction: lifecycleAction,
    publishVersionAction: lifecycleAction,
    returnToDraftAction: lifecycleAction,
    submitForTestingAction: lifecycleAction,
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
  status: 'draft' | 'testing' | 'published' | 'archived' = 'draft',
): WorkflowVersionDetailResponse {
  const workflowDefinition = definition();
  workflowDefinition.status = status;
  return {
    schemaVersion: 1,
    workspaceId: 'b1a44632-f0ec-4f9d-901f-69d3ae992c45',
    access: {
      role,
      canEdit: role !== 'VIEWER' && status === 'draft',
    },
    workflowVersion: {
      id: 'bd947ba1-c033-442f-93d8-2f895fd3c32b',
      workflowId: 'workflow-session-11',
      version: 1,
      revision: 1,
      status,
      schemaVersion: 1,
      definition: workflowDefinition,
      createdFromVersionId: null,
      publishedAt: null,
      publishedById: null,
      archivedAt: null,
      archivedById: null,
      createdAt: '2026-07-29T19:00:00.000Z',
      updatedAt: '2026-07-29T20:00:00.000Z',
    },
    locatorMetadata: [
      {
        stepId: 'step-click',
        confidence: 'high',
        provenance: 'testId',
      },
    ],
    publishReadiness: analyzePublishReadiness(workflowDefinition),
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

  it.each(['testing', 'published', 'archived'] as const)(
    'keeps %s versions read-only',
    (status) => {
      render(
        <WorkflowEditor
          detail={detail('MEMBER', status)}
          workspaceId={detail().workspaceId}
        />,
      );

      expect(
        screen.getByText(new RegExp(`${status} versions are immutable`, 'i')),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Workflow name')).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    },
  );

  it('shows role-appropriate Testing actions', () => {
    const { rerender } = render(
      <WorkflowEditor
        detail={detail('MEMBER', 'testing')}
        workspaceId={detail().workspaceId}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Return to Draft' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Publish' }),
    ).not.toBeInTheDocument();

    rerender(
      <WorkflowEditor
        detail={detail('ADMIN', 'testing')}
        workspaceId={detail().workspaceId}
      />,
    );
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();
  });

  it('blocks Testing submission when readiness has blocking issues', () => {
    const blocked = detail('MEMBER', 'draft');
    blocked.workflowVersion.definition.steps = [];

    render(
      <WorkflowEditor detail={blocked} workspaceId={blocked.workspaceId} />,
    );

    expect(
      screen.getByRole('button', { name: 'Submit for Testing' }),
    ).toBeDisabled();
    expect(
      screen.getByText(/Resolve every blocking issue/i),
    ).toBeInTheDocument();
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
    expect(screen.getByText(/Revision 2 · Saved/)).toBeInTheDocument();
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

  it('adds, binds, atomically renames, and protects a referenced variable', async () => {
    const user = userEvent.setup();
    render(
      <WorkflowEditor detail={detail()} workspaceId={detail().workspaceId} />,
    );

    await user.type(
      screen.getByLabelText('New variable name'),
      'customerEmail',
    );
    await user.click(screen.getByRole('button', { name: 'Add variable' }));
    expect(
      screen.getByRole('button', { name: /customerEmail.*0 usages/ }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', {
        name: 'Step 3: fill, Use secret reference',
      }),
    );
    await user.selectOptions(screen.getByLabelText('Value source'), 'variable');
    expect(screen.getByLabelText('Compatible variable')).toHaveValue(
      'customerEmail',
    );

    const name = screen.getByLabelText('Name', { exact: true });
    await user.clear(name);
    await user.type(name, 'contactEmail');
    await user.click(
      screen.getByRole('button', { name: 'Rename and update references' }),
    );

    expect(screen.getByLabelText('Compatible variable')).toHaveValue(
      'contactEmail',
    );
    expect(screen.getByText('Used by 1 step(s)')).toBeInTheDocument();
    expect(screen.getByText(/Remove is blocked/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Remove unused variable' }),
    ).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Type'), 'file');
    expect(
      screen.getByText(/incompatible with one or more usages/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Type')).toHaveValue('string');
  });

  it('adds an Extract step, binds its output, renames references, and protects deletion', async () => {
    const user = userEvent.setup();
    render(
      <WorkflowEditor detail={detail()} workspaceId={detail().workspaceId} />,
    );

    await user.click(screen.getByRole('button', { name: 'Add Text Extract' }));
    expect(screen.getByText('Outputs')).toBeInTheDocument();
    const outputsPanel = screen.getByRole('region', { name: 'Outputs' });
    const outputName = within(outputsPanel).getByLabelText('Output name', {
      exact: true,
    });
    await user.clear(outputName);
    await user.type(outputName, 'customerId');
    await user.click(screen.getByRole('button', { name: 'Rename output' }));

    await user.click(screen.getByRole('button', { name: 'Move up' }));
    await user.click(screen.getByRole('button', { name: 'Move up' }));
    await user.click(
      screen.getByRole('button', {
        name: 'Step 4: fill, Use secret reference',
      }),
    );
    await user.selectOptions(screen.getByLabelText('Value source'), 'output');
    expect(screen.getByLabelText('Compatible earlier output')).toHaveValue(
      'customerId',
    );

    const renamed = within(outputsPanel).getByLabelText('Output name', {
      exact: true,
    });
    await user.clear(renamed);
    await user.type(renamed, 'crmCustomerId');
    await user.click(screen.getByRole('button', { name: 'Rename output' }));
    expect(screen.getByLabelText('Compatible earlier output')).toHaveValue(
      'crmCustomerId',
    );
    expect(
      screen.getByRole('button', { name: 'Delete unused Extract' }),
    ).toBeDisabled();
    expect(document.body.textContent).not.toContain('output value preview');
  });

  it('removes an unused variable only after confirmation', async () => {
    const user = userEvent.setup();
    render(
      <WorkflowEditor detail={detail()} workspaceId={detail().workspaceId} />,
    );

    await user.type(screen.getByLabelText('New variable name'), 'unusedInput');
    await user.click(screen.getByRole('button', { name: 'Add variable' }));
    await user.click(
      screen.getByRole('button', { name: 'Remove unused variable' }),
    );
    expect(
      screen.getByRole('button', { name: 'Confirm remove' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm remove' }));
    expect(
      screen.queryByRole('button', { name: /unusedInput/ }),
    ).not.toBeInTheDocument();
  });

  it('keeps preview inputs in memory only, clears them on close, and retains safe file metadata', async () => {
    const user = userEvent.setup();
    const previewDetail = detail();
    previewDetail.workflowVersion.definition.variables = [
      {
        name: 'customerEmail',
        label: 'Customer email',
        valueType: 'string',
        required: true,
      },
      {
        name: 'scheduledOn',
        valueType: 'date',
        required: false,
      },
      {
        name: 'attachment',
        valueType: 'file',
        required: false,
      },
    ];
    const localStorageWrite = vi.spyOn(Storage.prototype, 'setItem');
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    render(
      <WorkflowEditor
        detail={previewDetail}
        workspaceId={previewDetail.workspaceId}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Preview run inputs' }),
    );
    const dialog = screen.getByRole('dialog', {
      name: 'Run Inputs Preview',
    });
    const email = within(dialog).getByLabelText(/Customer email/);
    await user.type(email, 'private@example.test');
    await user.click(
      within(dialog).getByRole('button', {
        name: 'Validate temporary inputs',
      }),
    );
    expect(
      within(dialog).getByText('Temporary inputs are valid.'),
    ).toBeInTheDocument();

    const file = new File(['safe fixture'], 'private-name.txt', {
      type: 'text/plain',
    });
    fireEvent.change(within(dialog).getByLabelText('attachment'), {
      target: { files: [file] },
    });
    expect(within(dialog).getByText(/12 bytes/)).toBeInTheDocument();
    expect(
      within(dialog).queryByText('private-name.txt'),
    ).not.toBeInTheDocument();

    await user.click(
      within(dialog).getByRole('button', { name: 'Close and clear' }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Preview run inputs' }),
    );
    expect(screen.getByLabelText(/Customer email/)).toHaveValue('');
    expect(localStorageWrite).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(JSON.stringify(localStorage)).not.toContain('private@example.test');
    expect(JSON.stringify(sessionStorage)).not.toContain(
      'private@example.test',
    );

    consoleLog.mockRestore();
    localStorageWrite.mockRestore();
  });

  it('saves variable declarations and references in the Draft definition', async () => {
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
        updatedAt: '2026-07-30T00:00:00.000Z',
      }),
    );
    render(
      <WorkflowEditor detail={detail()} workspaceId={detail().workspaceId} />,
    );

    await user.type(
      screen.getByLabelText('New variable name'),
      'customerEmail',
    );
    await user.click(screen.getByRole('button', { name: 'Add variable' }));
    await user.click(
      screen.getByRole('button', {
        name: 'Step 3: fill, Use secret reference',
      }),
    );
    await user.selectOptions(screen.getByLabelText('Value source'), 'variable');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(saveDraft).toHaveBeenCalledWith(
      detail().workflowVersion.id,
      1,
      expect.objectContaining({
        variables: [
          expect.objectContaining({
            name: 'customerEmail',
            valueType: 'string',
          }),
        ],
        steps: expect.arrayContaining([
          expect.objectContaining({
            id: 'step-secret',
            value: {
              kind: 'variable',
              variableName: 'customerEmail',
            },
          }),
        ]),
      }),
    );
    expect(
      await screen.findByText(/Draft saved at revision 2/),
    ).toBeInTheDocument();
  });

  it('adds URL and locator-reuse Verify steps without exposing locator editing', async () => {
    const user = userEvent.setup();
    render(<WorkflowEditor detail={detail()} workspaceId="workspace" />);

    await user.click(screen.getByRole('button', { name: 'Add URL Verify' }));
    expect(screen.getByLabelText('URL match mode')).toBeEnabled();
    expect(
      screen.getByLabelText('Verification timeout (milliseconds)'),
    ).toHaveValue(5000);

    await user.selectOptions(
      screen.getByLabelText('Locator source step'),
      'step-click',
    );
    await user.click(
      screen.getByRole('button', { name: 'Add Element Verify' }),
    );
    expect(screen.getByText('Read-only locator')).toBeInTheDocument();
    expect(screen.getByText('Kind: testId')).toBeInTheDocument();
    expect(screen.queryByLabelText('CSS selector')).not.toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText('Verification kind'),
      'text',
    );
    expect(screen.getByLabelText('Text match mode')).toBeEnabled();
    expect(
      within(screen.getByRole('group', { name: 'Expected text' })).queryByRole(
        'option',
        { name: 'Secret reference' },
      ),
    ).not.toBeInTheDocument();

    fireEvent.change(
      screen.getByLabelText('Verification timeout (milliseconds)'),
      { target: { value: '99' } },
    );
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  });
});
