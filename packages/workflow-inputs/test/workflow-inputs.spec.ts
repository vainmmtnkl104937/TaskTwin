import type { FillStep, WorkflowDefinition } from '@tasktwin/workflow-schema';
import { describe, expect, it } from 'vitest';

import {
  RuntimeFileMetadataSchema,
  WorkflowRunInputSubmissionSchema,
  analyzeWorkflowInputs,
  isSafeSecretAlias,
  prepareRunInputPlan,
  validateWorkflowRunInputs,
} from '../src/index.js';

function workflow(): WorkflowDefinition {
  return {
    schemaVersion: 1,
    workflowId: 'workflowInputsTest',
    version: 1,
    name: 'Workflow inputs test',
    status: 'draft',
    variables: [
      {
        name: 'customerEmail',
        label: 'Customer email',
        valueType: 'string',
        required: true,
      },
      {
        name: 'countryId',
        valueType: 'number',
        required: false,
      },
      {
        name: 'unusedFlag',
        valueType: 'boolean',
        required: false,
      },
    ],
    steps: [
      {
        id: 'fill-email',
        type: 'fill',
        name: 'Fill email',
        locator: { kind: 'label', value: 'Email' },
        value: { kind: 'variable', variableName: 'customerEmail' },
      },
      {
        id: 'select-country',
        type: 'select',
        name: 'Select country',
        locator: { kind: 'label', value: 'Country' },
        value: { kind: 'variable', variableName: 'countryId' },
      },
      {
        id: 'fill-password',
        type: 'fill',
        name: 'Fill password',
        locator: { kind: 'label', value: 'Password' },
        value: { kind: 'secret', secretName: 'crmPassword' },
      },
    ],
  };
}

describe('workflow input analysis', () => {
  it('analyzes valid variables, usages, warnings, and secret requirements', () => {
    const result = analyzeWorkflowInputs(workflow());

    expect(result.hasBlockingIssues).toBe(false);
    expect(result.variables.map((item) => item.usageCount)).toEqual([1, 1, 0]);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'UNUSED_VARIABLE',
        severity: 'warning',
        variableName: 'unusedFlag',
      }),
    ]);
    expect(result.secretRequirements).toEqual([
      expect.objectContaining({
        secretName: 'crmPassword',
        usageCount: 1,
      }),
    ]);
  });

  it('reports duplicate and unknown variable names without echoing values', () => {
    const duplicate = workflow();
    duplicate.variables.push({ ...duplicate.variables[0]! });
    expect(analyzeWorkflowInputs(duplicate).issues).toEqual([
      expect.objectContaining({ code: 'DUPLICATE_VARIABLE_NAME' }),
    ]);

    const unknown = workflow();
    unknown.steps[0] = {
      ...(unknown.steps[0] as FillStep),
      type: 'fill',
      value: { kind: 'variable', variableName: 'missingVariable' },
    };
    expect(analyzeWorkflowInputs(unknown).issues).toContainEqual(
      expect.objectContaining({
        code: 'UNKNOWN_VARIABLE_REFERENCE',
        variableName: 'missingVariable',
      }),
    );
  });

  it('uses deterministic declaration and execution ordering', () => {
    const input = workflow();
    input.variables = [
      { name: 'firstUnused', valueType: 'string', required: false },
      { name: 'secondUnused', valueType: 'boolean', required: false },
    ];
    input.steps = [
      {
        id: 'first',
        type: 'fill',
        name: 'First',
        locator: { kind: 'label', value: 'First' },
        value: { kind: 'variable', variableName: 'missingFirst' },
      },
      {
        id: 'second',
        type: 'select',
        name: 'Second',
        locator: { kind: 'label', value: 'Second' },
        value: { kind: 'variable', variableName: 'missingSecond' },
      },
    ];

    expect(
      analyzeWorkflowInputs(input).issues.map((issue) => issue.code),
    ).toEqual([
      'UNKNOWN_VARIABLE_REFERENCE',
      'UNKNOWN_VARIABLE_REFERENCE',
      'UNUSED_VARIABLE',
      'UNUSED_VARIABLE',
    ]);
  });

  it('accepts compatible Fill and Select variables and rejects File', () => {
    const input = workflow();
    input.variables[0] = {
      name: 'customerEmail',
      valueType: 'file',
      required: true,
    };

    expect(analyzeWorkflowInputs(input).issues).toContainEqual(
      expect.objectContaining({
        code: 'INCOMPATIBLE_VARIABLE_TYPE',
        variableName: 'customerEmail',
      }),
    );

    input.variables[0] = {
      name: 'customerEmail',
      valueType: 'string',
      required: true,
    };
    expect(
      analyzeWorkflowInputs(input).issues.filter(
        (issue) => issue.code === 'INCOMPATIBLE_VARIABLE_TYPE',
      ),
    ).toHaveLength(0);
  });

  it('rejects unsafe aliases and never treats them as requirements', () => {
    const input = workflow();
    input.steps[2] = {
      ...(input.steps[2] as FillStep),
      type: 'fill',
      value: {
        kind: 'secret',
        secretName: 'eyJabcdefghijk.abcdefghijk.abcdefghijk',
      },
    };

    const result = analyzeWorkflowInputs(input);
    expect(result.secretRequirements).toEqual([]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'UNSAFE_SECRET_REFERENCE' }),
    );
    expect(JSON.stringify(result.issues)).not.toContain('eyJabcdefghijk');
    expect(isSafeSecretAlias('crmPassword')).toBe(true);
    expect(isSafeSecretAlias('person@example.com')).toBe(false);
  });
});

describe('run input contracts', () => {
  it('validates string, finite number, boolean, date, and safe file metadata', () => {
    const input = workflow();
    input.variables = [
      { name: 'text', valueType: 'string', required: true },
      { name: 'amount', valueType: 'number', required: true },
      { name: 'enabled', valueType: 'boolean', required: true },
      { name: 'scheduledOn', valueType: 'date', required: true },
      { name: 'attachment', valueType: 'file', required: true },
    ];
    input.steps = [
      {
        id: 'wait',
        type: 'wait',
        name: 'Wait',
        durationMs: 10,
      },
    ];
    const submission = {
      schemaVersion: 1,
      values: {
        text: { kind: 'string', value: 'safe' },
        amount: { kind: 'number', value: 12.5 },
        enabled: { kind: 'boolean', value: true },
        scheduledOn: { kind: 'date', value: '2026-07-30' },
        attachment: {
          kind: 'file',
          metadata: { sizeBytes: 128, mediaType: 'text/plain' },
        },
      },
    };

    expect(validateWorkflowRunInputs(input, submission)).toMatchObject({
      issues: [],
      summary: {
        declaredCount: 5,
        providedCount: 5,
        fileCount: 1,
        valid: true,
      },
    });
    expect(RuntimeFileMetadataSchema.safeParse({ sizeBytes: -1 }).success).toBe(
      false,
    );
    expect(
      WorkflowRunInputSubmissionSchema.safeParse({
        schemaVersion: 1,
        values: { amount: { kind: 'number', value: Number.POSITIVE_INFINITY } },
      }).success,
    ).toBe(false);
  });

  it('rejects missing, unknown, wrong-type, and invalid date inputs', () => {
    const missing = validateWorkflowRunInputs(workflow(), {
      schemaVersion: 1,
      values: {
        unknownInput: { kind: 'string', value: 'not logged' },
        customerEmail: { kind: 'boolean', value: true },
      },
    });

    expect(missing.issues.map((issue) => issue.code)).toEqual([
      'RUNTIME_INPUT_TYPE_MISMATCH',
      'UNKNOWN_RUNTIME_INPUT',
    ]);

    expect(
      WorkflowRunInputSubmissionSchema.safeParse({
        schemaVersion: 1,
        values: {
          scheduledOn: { kind: 'date', value: '2026-02-30' },
        },
      }).success,
    ).toBe(false);

    expect(
      validateWorkflowRunInputs(workflow(), {
        schemaVersion: 1,
        values: {},
      }).issues,
    ).toContainEqual(
      expect.objectContaining({ code: 'MISSING_REQUIRED_INPUT' }),
    );
  });

  it('cannot accept secrets and produces a counts-only summary', () => {
    expect(
      WorkflowRunInputSubmissionSchema.safeParse({
        schemaVersion: 1,
        values: {
          crmPassword: { kind: 'secret', value: 'must-not-appear' },
        },
      }).success,
    ).toBe(false);

    const result = validateWorkflowRunInputs(workflow(), {
      schemaVersion: 1,
      values: {
        customerEmail: { kind: 'string', value: 'private@example.com' },
      },
    });
    expect(Object.keys(result.summary).sort()).toEqual(
      [
        'declaredCount',
        'fileCount',
        'issueCount',
        'missingRequiredCount',
        'providedCount',
        'requiredCount',
        'valid',
      ].sort(),
    );
    expect(JSON.stringify(result.summary)).not.toContain('private@example.com');
    expect(
      prepareRunInputPlan(workflow()).secretRequirements[0]?.secretName,
    ).toBe('crmPassword');
  });
});
