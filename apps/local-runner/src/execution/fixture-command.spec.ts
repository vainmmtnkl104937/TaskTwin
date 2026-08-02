import {
  WorkflowExecutionResultSchema,
  type WorkflowExecutionResult,
} from '@tasktwin/workflow-engine';
import { describe, expect, it } from 'vitest';

import { executionExitCode } from './fixture-command.js';

function result(
  status: WorkflowExecutionResult['status'],
): WorkflowExecutionResult {
  const cause = {
    succeeded: 'completed',
    failed: 'step_failed',
    cancelled: 'run_cancelled',
    timed_out: 'total_timeout',
    interrupted: 'approval_invalidated',
  } as const;
  return WorkflowExecutionResultSchema.parse({
    schemaVersion: 1,
    executionId: '00000000-0000-4000-8000-000000000016',
    workflowId: 'fixture',
    workflowVersion: 1,
    status,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:00.001Z',
    durationMs: 1,
    terminationCause: cause[status],
    counts: {
      total: 0,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      timedOut: 0,
      interrupted: 0,
      skipped: 0,
    },
    warnings: [],
    steps: [],
  });
}

describe('fixture command exit codes', () => {
  it('maps success, failure, cancellation and timeout deterministically', () => {
    expect(executionExitCode(result('succeeded'), true)).toBe(0);
    expect(executionExitCode(result('succeeded'), false)).toBe(1);
    expect(executionExitCode(result('failed'), false)).toBe(1);
    expect(executionExitCode(result('cancelled'), false)).toBe(2);
    expect(executionExitCode(result('timed_out'), false)).toBe(3);
  });
});
