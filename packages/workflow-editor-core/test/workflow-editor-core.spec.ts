import type {
  NavigateStep,
  WaitStep,
  WorkflowDefinition,
} from '@tasktwin/workflow-schema';
import { describe, expect, it } from 'vitest';

import {
  addVariable,
  addApprovalStep,
  addWaitStep,
  deriveLinearGraph,
  findVariableUsages,
  findDuplicateStepIds,
  moveWorkflowStepDown,
  moveWorkflowStepUp,
  removeVariable,
  renameVariable,
  removeWorkflowStep,
  summarizeNavigateUrl,
  updateStepValueSource,
  updateVariable,
  updateWorkflowMetadata,
  updateWorkflowStep,
  validateEditorWorkflow,
  addElementExtractStep,
  renameWorkflowOutput,
  removeExtractStep,
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
        riskLevel: 'medium',
        scope: 'next_step',
        timeoutMs: 30_000,
      },
    ],
  };
}

describe('workflow editor operations', () => {
  it('adds, renames and safely removes Extract outputs immutably', () => {
    const original = createWorkflow();
    const withLocator = {
      ...original,
      steps: [
        ...original.steps,
        {
          id: 'field',
          type: 'fill' as const,
          name: 'Customer field',
          locator: { kind: 'label' as const, value: 'Customer ID' },
          value: { kind: 'literal' as const, value: '' },
        },
      ],
    };
    const added = addElementExtractStep(
      withLocator,
      'field',
      {
        id: 'extract',
        name: 'Extract customer',
        outputName: 'customerId',
      },
      withLocator.steps.length - 1,
    );
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const consumer = updateStepValueSource(
      added.workflow,
      'field',
      'fill.value',
      { kind: 'output', outputName: 'customerId' },
    );
    expect(consumer.ok).toBe(true);
    if (!consumer.ok) return;
    const renamed = renameWorkflowOutput(
      consumer.workflow,
      'customerId',
      'crmCustomerId',
    );
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(
      renamed.workflow.steps.find((step) => step.id === 'field'),
    ).toMatchObject({
      value: { kind: 'output', outputName: 'crmCustomerId' },
    });
    expect(removeExtractStep(renamed.workflow, 'extract')).toMatchObject({
      ok: false,
      error: { code: 'OUTPUT_HAS_USAGES' },
    });
    expect(original).toEqual(createWorkflow());
  });

  it('allows removing an unused Extract step and rejects rename collisions', () => {
    const original = createWorkflow();
    const first = {
      id: 'firstExtract',
      type: 'extract' as const,
      name: 'First',
      locator: { kind: 'testId' as const, value: 'first' },
      source: { kind: 'text' as const },
      outputName: 'firstOutput',
      retention: 'ephemeral' as const,
    };
    const second = {
      ...first,
      id: 'secondExtract',
      outputName: 'secondOutput',
    };
    const workflow = { ...original, steps: [...original.steps, first, second] };
    expect(
      renameWorkflowOutput(workflow, 'firstOutput', 'secondOutput'),
    ).toMatchObject({
      ok: false,
      error: { code: 'OUTPUT_NAME_COLLISION' },
    });
    const removed = removeExtractStep(workflow, 'firstExtract');
    expect(removed.ok).toBe(true);
    if (removed.ok) {
      expect(
        removed.workflow.steps.some((step) => step.id === 'firstExtract'),
      ).toBe(false);
    }
  });
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
      riskLevel: 'medium',
      scope: 'next_step',
      timeoutMs: 30_000,
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
        riskLevel: 'medium',
        scope: 'next_step',
        timeoutMs: 30_000,
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

describe('workflow variable operations', () => {
  function variableWorkflow(): WorkflowDefinition {
    const input = createWorkflow();
    input.variables = [
      {
        name: 'customerEmail',
        label: 'Customer email',
        valueType: 'string',
        required: true,
      },
      {
        name: 'unusedFlag',
        valueType: 'boolean',
        required: false,
      },
    ];
    input.steps.push({
      id: 'step-4',
      type: 'fill',
      name: 'Fill email',
      locator: { kind: 'label', value: 'Email' },
      value: { kind: 'variable', variableName: 'customerEmail' },
    });
    input.steps.push({
      id: 'step-5',
      type: 'verify',
      name: 'Verify email',
      assertion: {
        kind: 'value',
        locator: { kind: 'label', value: 'Email' },
        operator: 'equals',
        expected: { kind: 'variable', variableName: 'customerEmail' },
      },
    });
    return input;
  }

  it('adds a variable without mutating the source workflow', () => {
    const original = createWorkflow();
    const result = addVariable(original, {
      name: 'customerEmail',
      valueType: 'string',
      required: true,
    });

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.workflow.variables).toHaveLength(1);
    }
    expect(original.variables).toEqual([]);
  });

  it('renames declarations and every reference atomically', () => {
    const original = variableWorkflow();
    const snapshot = structuredClone(original);
    const result = renameVariable(original, 'customerEmail', 'contactEmail');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workflow.variables[0]?.name).toBe('contactEmail');
      expect(
        findVariableUsages(result.workflow, 'contactEmail').map(
          (usage) => usage.stepId,
        ),
      ).toEqual(['step-4', 'step-5']);
      expect(findVariableUsages(result.workflow, 'customerEmail')).toEqual([]);
    }
    expect(original).toEqual(snapshot);
  });

  it('rejects rename collisions without changing the workflow', () => {
    const original = variableWorkflow();
    const result = renameVariable(original, 'customerEmail', 'unusedFlag');

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VARIABLE_NAME_COLLISION' },
    });
    expect(original.variables[0]?.name).toBe('customerEmail');
  });

  it('removes unused variables and rejects referenced removal', () => {
    const original = variableWorkflow();
    const unused = removeVariable(original, 'unusedFlag');
    const referenced = removeVariable(original, 'customerEmail');

    expect(unused.ok).toBe(true);
    if (unused.ok) {
      expect(unused.workflow.variables.map((item) => item.name)).toEqual([
        'customerEmail',
      ]);
    }
    expect(referenced).toMatchObject({
      ok: false,
      error: {
        code: 'VARIABLE_HAS_USAGES',
        usages: [{ stepId: 'step-4' }, { stepId: 'step-5' }],
      },
    });
  });

  it('allows compatible metadata changes and rejects incompatible type changes', () => {
    const original = variableWorkflow();
    const compatible = updateVariable(original, 'customerEmail', {
      ...original.variables[0]!,
      label: 'Contact email',
    });
    const incompatible = updateVariable(original, 'customerEmail', {
      ...original.variables[0]!,
      valueType: 'file',
    });

    expect(compatible).toMatchObject({ ok: true });
    expect(incompatible).toMatchObject({
      ok: false,
      error: { code: 'VARIABLE_TYPE_INCOMPATIBLE' },
    });
    expect(original.variables[0]?.valueType).toBe('string');
  });

  it('updates literal to variable and variable to secret without mutation', () => {
    const original = variableWorkflow();
    const variableResult = updateStepValueSource(
      original,
      'step-1',
      'navigate.url',
      { kind: 'variable', variableName: 'customerEmail' },
    );
    expect(variableResult).toMatchObject({ ok: true });

    const literalFill = structuredClone(original);
    literalFill.steps[3] = {
      ...literalFill.steps[3]!,
      type: 'fill',
      locator: { kind: 'label', value: 'Email' },
      value: { kind: 'literal', value: 'safe@example.test' },
    };
    const secretResult = updateStepValueSource(
      literalFill,
      'step-4',
      'fill.value',
      { kind: 'secret', secretName: 'crmPassword' },
    );

    expect(secretResult).toMatchObject({ ok: true });
    if (secretResult.ok) {
      expect(secretResult.workflow.steps[3]).toMatchObject({
        value: { kind: 'secret', secretName: 'crmPassword' },
      });
    }
    expect(original.steps[3]).toMatchObject({
      value: { kind: 'variable', variableName: 'customerEmail' },
    });
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

    const issues = validateEditorWorkflow(workflow);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'NAVIGATE_URL_SENSITIVE_QUERY',
          stepId: 'step-1',
        }),
      ]),
    );
    expect(JSON.stringify(issues)).not.toContain('not-for-display');
    expect(
      summarizeNavigateUrl(
        'https://example.com/start?page=2&access_token=not-for-display',
      ),
    ).toBe('https://example.com/start?page=…');
  });
});
