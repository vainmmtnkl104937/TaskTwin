import type {
  NavigateStep,
  WaitStep,
  WorkflowDefinition,
} from '@tasktwin/workflow-schema';
import { describe, expect, it } from 'vitest';

import {
  addApprovalStep,
  addWaitStep,
  deriveLinearGraph,
  findDuplicateStepIds,
  moveWorkflowStepDown,
  moveWorkflowStepUp,
  removeWorkflowStep,
  summarizeNavigateUrl,
  updateWorkflowMetadata,
  updateWorkflowStep,
  validateEditorWorkflow,
} from '../src/index.js';

function createWorkflow(): WorkflowDefinition {
  return {
    schemaVersion: 1,
    workflowId: 'workflow-editor-test',
    version: 1,
    name: 'Editor test',
    status: 'draft',
    variables: [],
    steps: [
      {
        id: 'step-1',
        type: 'navigate',
        name: 'Open page',
        url: { kind: 'literal', value: 'https://example.com/start' },
      },
      {
        id: 'step-2',
        type: 'wait',
        name: 'Wait',
        durationMs: 500,
      },
      {
        id: 'step-3',
        type: 'approval',
        name: 'Review',
        message: 'Continue?',
      },
    ],
  };
}

describe('workflow editor operations', () => {
  it('updates metadata immutably', () => {
    const original = createWorkflow();
    const result = updateWorkflowMetadata(original, {
      name: 'Updated',
      description: 'Safe description',
    });

    expect(result).not.toBe(original);
    expect(result.name).toBe('Updated');
    expect(result.description).toBe('Safe description');
    expect(original).toEqual(createWorkflow());
  });

  it('updates a step without mutating the source workflow', () => {
    const original = createWorkflow();
    const waitStep = original.steps[1] as WaitStep;
    const result = updateWorkflowStep(original, 'step-2', {
      ...waitStep,
      name: 'Updated wait',
      durationMs: 1_000,
    });

    expect(result.steps).not.toBe(original.steps);
    expect(result.steps[1]).toMatchObject({
      name: 'Updated wait',
      durationMs: 1_000,
    });
    expect(original.steps[1]).toMatchObject({ name: 'Wait', durationMs: 500 });
  });

  it('moves steps up and down while preserving boundaries', () => {
    const original = createWorkflow();
    const movedUp = moveWorkflowStepUp(original, 'step-2');
    const movedDown = moveWorkflowStepDown(movedUp, 'step-2');

    expect(movedUp.steps.map((step) => step.id)).toEqual([
      'step-2',
      'step-1',
      'step-3',
    ]);
    expect(movedDown.steps.map((step) => step.id)).toEqual([
      'step-1',
      'step-2',
      'step-3',
    ]);
    expect(moveWorkflowStepUp(original, 'step-1')).toBe(original);
    expect(moveWorkflowStepDown(original, 'step-3')).toBe(original);
  });

  it('adds Wait and Approval steps using caller-supplied IDs', () => {
    const withWait = addWaitStep(createWorkflow(), {
      id: 'step-4',
      name: 'Extra wait',
      durationMs: 250,
    });
    const withApproval = addApprovalStep(withWait, {
      id: 'step-5',
      name: 'Extra approval',
      message: 'Approve the next action.',
    });

    expect(withApproval.steps.slice(-2)).toEqual([
      {
        id: 'step-4',
        type: 'wait',
        name: 'Extra wait',
        durationMs: 250,
      },
      {
        id: 'step-5',
        type: 'approval',
        name: 'Extra approval',
        message: 'Approve the next action.',
      },
    ]);
  });

  it('removes a step without changing the original', () => {
    const original = createWorkflow();
    const result = removeWorkflowStep(original, 'step-2');

    expect(result.steps.map((step) => step.id)).toEqual(['step-1', 'step-3']);
    expect(original.steps).toHaveLength(3);
  });

  it('detects duplicate IDs in deterministic encounter order', () => {
    const workflow = createWorkflow();
    workflow.steps = [
      ...workflow.steps,
      { ...workflow.steps[0]!, name: 'Duplicate one' },
      { ...workflow.steps[1]!, name: 'Duplicate two' },
    ];

    expect(findDuplicateStepIds(workflow)).toEqual(['step-1', 'step-2']);
  });
});

describe('linear graph derivation', () => {
  it('creates deterministic nodes and consecutive edges', () => {
    const workflow = createWorkflow();

    expect(deriveLinearGraph(workflow)).toEqual({
      nodes: [
        {
          id: 'step-1',
          index: 0,
          stepType: 'navigate',
          label: 'Open page',
          position: { x: 0, y: 0 },
        },
        {
          id: 'step-2',
          index: 1,
          stepType: 'wait',
          label: 'Wait',
          position: { x: 0, y: 144 },
        },
        {
          id: 'step-3',
          index: 2,
          stepType: 'approval',
          label: 'Review',
          position: { x: 0, y: 288 },
        },
      ],
      edges: [
        { id: 'edge:step-1:step-2', source: 'step-1', target: 'step-2' },
        { id: 'edge:step-2:step-3', source: 'step-2', target: 'step-3' },
      ],
    });
  });
});

describe('editor validation', () => {
  it('maps schema problems to step context', () => {
    const workflow = createWorkflow();
    workflow.steps[1] = {
      ...(workflow.steps[1] as WaitStep),
      durationMs: 0,
    };

    expect(validateEditorWorkflow(workflow)).toEqual([
      expect.objectContaining({
        path: ['steps', 1, 'durationMs'],
        stepId: 'step-2',
        stepIndex: 1,
      }),
    ]);
  });

  it('rejects sensitive navigate query names and hides their values', () => {
    const workflow = createWorkflow();
    workflow.steps[0] = {
      ...(workflow.steps[0] as NavigateStep),
      url: {
        kind: 'literal',
        value: 'https://example.com/start?page=2&access_token=not-for-display',
      },
    };

    expect(validateEditorWorkflow(workflow)).toEqual([
      expect.objectContaining({
        code: 'NAVIGATE_URL_SENSITIVE_QUERY',
        stepId: 'step-1',
      }),
    ]);
    expect(
      summarizeNavigateUrl(
        'https://example.com/start?page=2&access_token=not-for-display',
      ),
    ).toBe('https://example.com/start?page=…');
  });
});
