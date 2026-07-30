import type { WorkflowLifecycleStatus } from '@tasktwin/workflow-schema';

import {
  WorkflowLifecycleTransitionResultSchema,
  type WorkflowLifecycleTransitionResult,
} from './contracts.js';

const VALID_TRANSITIONS = new Set<string>([
  'draft:testing',
  'testing:draft',
  'testing:published',
  'published:archived',
]);

export function canTransitionWorkflowLifecycle(
  from: WorkflowLifecycleStatus,
  to: WorkflowLifecycleStatus,
): boolean {
  return VALID_TRANSITIONS.has(`${from}:${to}`);
}

export function validateWorkflowLifecycleTransition(
  from: WorkflowLifecycleStatus,
  to: WorkflowLifecycleStatus,
): WorkflowLifecycleTransitionResult {
  if (!canTransitionWorkflowLifecycle(from, to)) {
    return WorkflowLifecycleTransitionResultSchema.parse({
      ok: false,
      error: {
        code: 'INVALID_LIFECYCLE_TRANSITION',
        message: 'The workflow lifecycle transition is not supported.',
      },
    });
  }

  return WorkflowLifecycleTransitionResultSchema.parse({
    ok: true,
    transition: { from, to },
  });
}
