import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ElementLocatorSchema,
  MAX_WAIT_DURATION_MS,
  RunStatusSchema,
  RunStepStatusSchema,
  ValueSourceSchema,
  WorkflowDefinitionSchema,
} from '../src/index.js';

const fixtureUrl = new URL(
  '../fixtures/valid-workflow.v1.json',
  import.meta.url,
);

function readValidFixture(): unknown {
  return JSON.parse(readFileSync(fixtureUrl, 'utf8')) as unknown;
}

function parseValidFixture() {
  return WorkflowDefinitionSchema.parse(readValidFixture());
}

describe('WorkflowDefinitionSchema', () => {
  it('parses a complete valid version 1 workflow fixture', () => {
    const workflow = parseValidFixture();

    expect(workflow.schemaVersion).toBe(1);
    expect(workflow.workflowId).toBe('exampleCheckout');
    expect(workflow.version).toBe(1);
  });

  it('supports every workflow step type in execution order', () => {
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

  it('rejects unsupported run statuses', () => {
    expect(RunStatusSchema.safeParse('paused').success).toBe(false);
    expect(RunStepStatusSchema.safeParse('unknown').success).toBe(false);
  });
});
