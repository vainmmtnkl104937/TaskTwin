import type { WorkflowDefinition } from '@tasktwin/workflow-schema';
import { describe, expect, it } from 'vitest';

import {
  analyzePublishReadiness,
  createDraftVersionClone,
  validateWorkflowLifecycleTransition,
} from '../src/index.js';

function workflow(): WorkflowDefinition {
  return {
    schemaVersion: 1,
    workflowId: 'workflow-lifecycle-test',
    version: 2,
    name: 'Lifecycle test',
    status: 'draft',
    variables: [
      {
        name: 'customerEmail',
        valueType: 'string',
        required: true,
      },
      {
        name: 'unusedFlag',
        valueType: 'boolean',
        required: false,
      },
    ],
    steps: [
      {
        id: 'step-fill',
        type: 'fill',
        name: 'Fill customer email',
        locator: { kind: 'label', value: 'Email' },
        value: { kind: 'variable', variableName: 'customerEmail' },
      },
    ],
  };
}

describe('workflow lifecycle transitions', () => {
  it.each([
    ['draft', 'testing'],
    ['testing', 'draft'],
    ['testing', 'published'],
    ['published', 'archived'],
  ] as const)('accepts %s -> %s', (from, to) => {
    expect(validateWorkflowLifecycleTransition(from, to)).toEqual({
      ok: true,
      transition: { from, to },
    });
  });

  it('rejects every unsupported transition deterministically', () => {
    const statuses = ['draft', 'testing', 'published', 'archived'] as const;
    const valid = new Set([
      'draft:testing',
      'testing:draft',
      'testing:published',
      'published:archived',
    ]);

    for (const from of statuses) {
      for (const to of statuses) {
        const result = validateWorkflowLifecycleTransition(from, to);
        expect(result.ok).toBe(valid.has(`${from}:${to}`));
        if (!result.ok) {
          expect(result.error.code).toBe('INVALID_LIFECYCLE_TRANSITION');
        }
      }
    }
  });
});

describe('publish readiness', () => {
  it('returns warnings without hiding a ready result', () => {
    const result = analyzePublishReadiness(workflow());

    expect(result.ready).toBe(true);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'UNUSED_VARIABLE',
        severity: 'warning',
      }),
    ]);
    expect(result.summary).toMatchObject({
      blockingCount: 0,
      warningCount: 1,
      stepCount: 1,
      variableCount: 2,
    });
  });

  it('reports an empty workflow as a blocking issue', () => {
    const result = analyzePublishReadiness({
      ...workflow(),
      steps: [],
    });

    expect(result.ready).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'WORKFLOW_STEPS_REQUIRED',
        severity: 'blocking',
      }),
    );
  });

  it('reports an unknown reference without exposing workflow values', () => {
    const input = workflow();
    const step = input.steps[0];
    if (step?.type !== 'fill') {
      throw new Error('Expected Fill step.');
    }
    step.value = { kind: 'variable', variableName: 'missingInput' };

    const result = analyzePublishReadiness(input);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'UNKNOWN_VARIABLE_REFERENCE',
        severity: 'blocking',
      }),
    );
    expect(JSON.stringify(result.issues)).not.toContain('private@example.test');
  });

  it('maps unsupported versions and duplicate step IDs to stable issues', () => {
    const unsupported = analyzePublishReadiness({
      ...workflow(),
      schemaVersion: 2,
    });
    expect(unsupported.issues[0]?.code).toBe(
      'UNSUPPORTED_WORKFLOW_SCHEMA_VERSION',
    );

    const duplicate = workflow();
    duplicate.steps.push({ ...duplicate.steps[0]! });
    expect(analyzePublishReadiness(duplicate).issues).toContainEqual(
      expect.objectContaining({ code: 'DUPLICATE_STEP_ID' }),
    );
  });

  it('preserves deterministic issue order', () => {
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
      analyzePublishReadiness(input).issues.map((issue) => issue.code),
    ).toEqual([
      'UNKNOWN_VARIABLE_REFERENCE',
      'UNKNOWN_VARIABLE_REFERENCE',
      'UNUSED_VARIABLE',
      'UNUSED_VARIABLE',
    ]);
  });
});

describe('draft version cloning', () => {
  it.each(['published', 'archived'] as const)(
    'clones a %s version without mutating the source',
    (sourceStatus) => {
      const source = workflow();
      source.status = sourceStatus;
      const snapshot = structuredClone(source);

      const result = createDraftVersionClone({
        sourceDefinition: source,
        sourceStatus,
        nextVersion: 3,
        createdAt: '2026-07-30T12:00:00.000Z',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.metadata).toEqual({
          version: 3,
          revision: 1,
          status: 'draft',
          createdAt: '2026-07-30T12:00:00.000Z',
        });
        expect(result.definition.steps.map((step) => step.id)).toEqual([
          'step-fill',
        ]);
        expect(result.definition.variables).toEqual(source.variables);
        expect(result.definition.status).toBe('draft');
        expect(result.definition.version).toBe(3);
      }
      expect(source).toEqual(snapshot);
    },
  );

  it.each(['draft', 'testing'] as const)(
    'rejects cloning from %s',
    (sourceStatus) => {
      expect(
        createDraftVersionClone({
          sourceDefinition: workflow(),
          sourceStatus,
          nextVersion: 3,
          createdAt: '2026-07-30T12:00:00.000Z',
        }),
      ).toMatchObject({
        ok: false,
        error: { code: 'SOURCE_VERSION_NOT_CLONEABLE' },
      });
    },
  );
});
