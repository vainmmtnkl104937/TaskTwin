import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ElementLocatorSchema,
  MAX_WAIT_DURATION_MS,
  RunStatusSchema,
  RunStepStatusSchema,
  SetCheckedStepSchema,
  ValueSourceSchema,
  WorkflowDefinitionSchema,
  WorkflowVariableSchema,
} from '../src/index.js';

const legacyFixtureUrl = new URL(
  '../fixtures/valid-workflow.v1.json',
  import.meta.url,
);
const setCheckedFixtureUrl = new URL(
  '../fixtures/valid-set-checked-workflow.v1.json',
  import.meta.url,
);

function readFixture(fixtureUrl: URL): unknown {
  return JSON.parse(readFileSync(fixtureUrl, 'utf8')) as unknown;
}

function parseValidFixture() {
  return WorkflowDefinitionSchema.parse(readFixture(legacyFixtureUrl));
}

describe('WorkflowDefinitionSchema', () => {
  it('keeps the legacy Session 02 workflow fixture valid', () => {
    const workflow = parseValidFixture();

    expect(workflow.schemaVersion).toBe(1);
    expect(workflow.workflowId).toBe('exampleCheckout');
    expect(workflow.version).toBe(1);
  });

  it('preserves the legacy workflow step order', () => {
    const workflow = parseValidFixture();

    expect(workflow.steps.map((step) => step.type)).toEqual([
      'navigate',
      'fill',
      'select',
      'click',
      'wait',
      'extract',
      'verify',
      'approval',
    ]);
  });

  it('parses deterministic checked and unchecked state steps', () => {
    const workflow = WorkflowDefinitionSchema.parse(
      readFixture(setCheckedFixtureUrl),
    );

    expect(workflow.steps).toEqual([
      {
        id: 'enableWelcomeEmail',
        type: 'setChecked',
        name: 'Enable Send welcome email',
        locator: {
          kind: 'label',
          value: 'Send welcome email',
          exact: true,
        },
        checked: true,
      },
      {
        id: 'disableArchiveCopy',
        type: 'setChecked',
        name: 'Disable Keep an archive copy',
        locator: {
          kind: 'testId',
          attribute: 'data-testid',
          value: 'archive-copy',
        },
        checked: false,
      },
    ]);
  });

  it('rejects a setChecked step without the required checked state', () => {
    expect(
      SetCheckedStepSchema.safeParse({
        id: 'missingCheckedState',
        type: 'setChecked',
        name: 'Set missing checked state',
        locator: {
          kind: 'label',
          value: 'Send welcome email',
        },
      }).success,
    ).toBe(false);
  });

  it('rejects a setChecked step with an invalid locator', () => {
    expect(
      SetCheckedStepSchema.safeParse({
        id: 'invalidCheckedLocator',
        type: 'setChecked',
        name: 'Set invalid checked locator',
        locator: {
          kind: 'css',
          selector: '   ',
        },
        checked: true,
      }).success,
    ).toBe(false);
  });

  it('rejects unexpected setChecked properties', () => {
    expect(
      SetCheckedStepSchema.safeParse({
        id: 'strictCheckedState',
        type: 'setChecked',
        name: 'Set strict checked state',
        locator: {
          kind: 'label',
          value: 'Send welcome email',
        },
        checked: true,
        toggle: true,
      }).success,
    ).toBe(false);
  });

  it('rejects an unsupported schema version', () => {
    const workflow = parseValidFixture();

    expect(
      WorkflowDefinitionSchema.safeParse({
        ...workflow,
        schemaVersion: 2,
      }).success,
    ).toBe(false);
  });

  it('rejects a non-positive workflow version', () => {
    const workflow = parseValidFixture();

    expect(
      WorkflowDefinitionSchema.safeParse({
        ...workflow,
        version: 0,
      }).success,
    ).toBe(false);
  });

  it('rejects an invalid variable name', () => {
    const workflow = parseValidFixture();
    const variable = workflow.variables[0];

    if (variable === undefined) {
      throw new Error('Expected the fixture to contain a variable.');
    }

    expect(
      WorkflowDefinitionSchema.safeParse({
        ...workflow,
        variables: [{ ...variable, name: 'invalid-variable-name' }],
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown workflow step type', () => {
    const workflow = parseValidFixture();

    expect(
      WorkflowDefinitionSchema.safeParse({
        ...workflow,
        steps: [
          ...workflow.steps,
          {
            id: 'hoverOverAccount',
            type: 'hover',
            name: 'Hover over account',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects a step with a missing required property', () => {
    const workflow = parseValidFixture();

    expect(
      WorkflowDefinitionSchema.safeParse({
        ...workflow,
        steps: [
          {
            id: 'clickWithoutLocator',
            type: 'click',
            name: 'Click without locator',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects an invalid locator', () => {
    expect(
      ElementLocatorSchema.safeParse({
        kind: 'css',
        selector: '   ',
      }).success,
    ).toBe(false);

    expect(
      ElementLocatorSchema.safeParse({
        kind: 'xpath',
        value: '//button',
      }).success,
    ).toBe(false);
  });

  it('supports additive placeholder and allowlisted test ID locators', () => {
    expect(
      ElementLocatorSchema.safeParse({
        kind: 'placeholder',
        value: 'Search tasks',
        exact: true,
      }).success,
    ).toBe(true);

    for (const attribute of [
      'data-testid',
      'data-test',
      'data-cy',
      'data-qa',
    ]) {
      expect(
        ElementLocatorSchema.safeParse({
          kind: 'testId',
          attribute,
          value: 'save-task',
        }).success,
      ).toBe(true);
    }

    expect(
      ElementLocatorSchema.safeParse({
        kind: 'testId',
        attribute: 'data-unknown',
        value: 'save-task',
      }).success,
    ).toBe(false);
  });

  it('rejects invalid wait durations', () => {
    const workflow = parseValidFixture();
    const baseWaitStep = {
      id: 'invalidWait',
      type: 'wait',
      name: 'Invalid wait',
    };

    for (const durationMs of [-1, 0, MAX_WAIT_DURATION_MS + 1]) {
      expect(
        WorkflowDefinitionSchema.safeParse({
          ...workflow,
          steps: [{ ...baseWaitStep, durationMs }],
        }).success,
      ).toBe(false);
    }
  });

  it('allows a secret reference name without a secret value', () => {
    const result = ValueSourceSchema.safeParse({
      kind: 'secret',
      secretName: 'checkoutAccessCode',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        kind: 'secret',
        secretName: 'checkoutAccessCode',
      });
    }
  });

  it('rejects secret references containing an actual value property', () => {
    expect(
      ValueSourceSchema.safeParse({
        kind: 'secret',
        secretName: 'checkoutAccessCode',
        value: 'must-not-be-stored',
      }).success,
    ).toBe(false);
  });

  it('rejects unexpected properties on workflow objects and steps', () => {
    const workflow = parseValidFixture();
    const firstStep = workflow.steps[0];

    if (firstStep === undefined) {
      throw new Error('Expected the fixture to contain a workflow step.');
    }

    expect(
      WorkflowDefinitionSchema.safeParse({
        ...workflow,
        unexpected: true,
      }).success,
    ).toBe(false);

    expect(
      WorkflowDefinitionSchema.safeParse({
        ...workflow,
        steps: [{ ...firstStep, unexpected: true }],
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate step IDs and variable names', () => {
    const workflow = parseValidFixture();
    const firstStep = workflow.steps[0];
    const firstVariable = workflow.variables[0];

    if (firstStep === undefined || firstVariable === undefined) {
      throw new Error('Expected the fixture to contain steps and variables.');
    }

    expect(
      WorkflowDefinitionSchema.safeParse({
        ...workflow,
        steps: [firstStep, firstStep],
      }).success,
    ).toBe(false);

    expect(
      WorkflowDefinitionSchema.safeParse({
        ...workflow,
        variables: [firstVariable, firstVariable],
      }).success,
    ).toBe(false);
  });

  it('supports bounded labels plus date and file variable declarations', () => {
    expect(
      WorkflowVariableSchema.safeParse({
        name: 'scheduledOn',
        label: 'Scheduled date',
        valueType: 'date',
        required: true,
      }).success,
    ).toBe(true);
    expect(
      WorkflowVariableSchema.safeParse({
        name: 'attachment',
        valueType: 'file',
        required: false,
      }).success,
    ).toBe(true);
    expect(
      WorkflowVariableSchema.safeParse({
        name: 'tooLong',
        label: 'x'.repeat(121),
        valueType: 'string',
        required: false,
      }).success,
    ).toBe(false);
  });

  it('rejects unsupported run statuses', () => {
    expect(RunStatusSchema.safeParse('paused').success).toBe(false);
    expect(RunStepStatusSchema.safeParse('unknown').success).toBe(false);
  });
});
