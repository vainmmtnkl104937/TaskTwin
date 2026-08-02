import { describe, expect, it } from 'vitest';

import {
  WorkflowProgressBatchSchema,
  analyzeWorkflowRunReadiness,
  canTransitionWorkflowRun,
} from '../src/index.js';

const published = {
  schemaVersion: 1,
  workflowId: 'session17',
  version: 1,
  name: 'Session 17',
  status: 'published',
  variables: [],
  steps: [
    {
      id: 'navigate',
      type: 'navigate',
      name: 'Navigate',
      url: { kind: 'literal', value: 'http://127.0.0.1:4177/path?private=1' },
    },
    { id: 'wait', type: 'wait', name: 'Wait', durationMs: 10 },
  ],
};

describe('run protocol', () => {
  it('derives origins for a supported published workflow', () => {
    expect(analyzeWorkflowRunReadiness(published)).toMatchObject({
      ready: true,
      allowedOrigins: ['http://127.0.0.1:4177'],
      issues: [],
    });
  });

  it.each(['draft', 'testing', 'archived'])(
    'rejects a %s workflow',
    (status) => {
      expect(analyzeWorkflowRunReadiness({ ...published, status }).ready).toBe(
        false,
      );
    },
  );

  it('rejects variables, secrets, unsupported steps and unsafe URLs', () => {
    const variable = {
      ...published,
      variables: [{ name: 'url', valueType: 'string', required: true }],
      steps: [
        {
          id: 'navigate',
          type: 'navigate',
          name: 'Navigate',
          url: { kind: 'variable', variableName: 'url' },
        },
      ],
    };
    expect(
      analyzeWorkflowRunReadiness(variable).issues.map((item) => item.code),
    ).toContain('RUNTIME_INPUT_REQUIRED');
    expect(
      analyzeWorkflowRunReadiness({
        ...published,
        steps: [
          published.steps[0],
          {
            id: 'fill',
            type: 'fill',
            name: 'Fill',
            locator: { kind: 'label', value: 'Password' },
            value: { kind: 'secret', secretName: 'crmPassword' },
          },
        ],
      }).issues.map((item) => item.code),
    ).toContain('SECRET_RESOLUTION_UNAVAILABLE');
    expect(
      analyzeWorkflowRunReadiness({
        ...published,
        steps: [
          published.steps[0],
          {
            id: 'approval',
            type: 'approval',
            name: 'Approve',
            message: 'Ok',
            riskLevel: 'medium',
            scope: 'next_step',
            timeoutMs: 30_000,
          },
        ],
      }).issues.map((item) => item.code),
    ).toContain('INVALID_WORKFLOW_DEFINITION');
    expect(
      analyzeWorkflowRunReadiness({
        ...published,
        steps: [
          {
            ...published.steps[0],
            url: { kind: 'literal', value: 'file:///private' },
          },
        ],
      }).ready,
    ).toBe(false);
  });

  it('validates contiguous progress and rejects unexpected properties', () => {
    const event = {
      executionId: '3d6f0a72-7580-4f89-8d20-43376f86b08d',
      timestamp: '2026-07-31T00:00:00.000Z',
      kind: 'run_status_changed',
      status: 'pending',
    };
    const batch = {
      schemaVersion: 1,
      clientBatchId: 'cb23feef-2217-48cf-b884-1fb0c5459243',
      firstSequence: 1,
      lastSequence: 2,
      events: [
        { sequence: 1, event },
        { sequence: 2, event: { ...event, status: 'validating' } },
      ],
    };
    expect(WorkflowProgressBatchSchema.safeParse(batch).success).toBe(true);
    expect(
      WorkflowProgressBatchSchema.safeParse({
        ...batch,
        events: [batch.events[0], { ...batch.events[1], sequence: 3 }],
      }).success,
    ).toBe(false);
    expect(
      WorkflowProgressBatchSchema.safeParse({ ...batch, extra: true }).success,
    ).toBe(false);
  });

  it('keeps terminal run statuses immutable', () => {
    expect(canTransitionWorkflowRun('QUEUED', 'CLAIMED')).toBe(true);
    expect(canTransitionWorkflowRun('SUCCEEDED', 'RUNNING')).toBe(false);
    expect(canTransitionWorkflowRun('INTERRUPTED', 'QUEUED')).toBe(false);
  });
});
