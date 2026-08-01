import {
  WorkflowDefinitionSchema,
  type WorkflowDefinition,
} from '@tasktwin/workflow-schema';
import { analyzeWorkflowInputs } from '@tasktwin/workflow-inputs';
import { analyzeWorkflowVerifications } from '@tasktwin/workflow-verification';

import { validateNavigateUrl } from './navigate-url-policy.js';

export interface WorkflowEditorIssue {
  code: string;
  message: string;
  path: Array<string | number>;
  stepId?: string;
  stepIndex?: number;
}

export function findDuplicateStepIds(
  workflow: Pick<WorkflowDefinition, 'steps'>,
): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const step of workflow.steps) {
    if (seen.has(step.id)) {
      duplicates.add(step.id);
    }
    seen.add(step.id);
  }

  return [...duplicates];
}

function withStepContext(
  issue: Omit<WorkflowEditorIssue, 'stepId' | 'stepIndex'>,
  workflow: unknown,
): WorkflowEditorIssue {
  const stepIndex =
    issue.path[0] === 'steps' && typeof issue.path[1] === 'number'
      ? issue.path[1]
      : undefined;
  const steps =
    typeof workflow === 'object' &&
    workflow !== null &&
    'steps' in workflow &&
    Array.isArray(workflow.steps)
      ? workflow.steps
      : [];
  const candidate = stepIndex === undefined ? undefined : steps[stepIndex];
  const stepId =
    typeof candidate === 'object' &&
    candidate !== null &&
    'id' in candidate &&
    typeof candidate.id === 'string'
      ? candidate.id
      : undefined;

  return {
    ...issue,
    ...(stepId === undefined ? {} : { stepId }),
    ...(stepIndex === undefined ? {} : { stepIndex }),
  };
}

export function validateEditorWorkflow(input: unknown): WorkflowEditorIssue[] {
  const result = WorkflowDefinitionSchema.safeParse(input);
  if (!result.success) {
    return result.error.issues.map((issue) =>
      withStepContext(
        {
          code: issue.code,
          message: issue.message,
          path: issue.path.filter(
            (segment): segment is string | number =>
              typeof segment === 'string' || typeof segment === 'number',
          ),
        },
        input,
      ),
    );
  }

  const issues: WorkflowEditorIssue[] = [];
  result.data.steps.forEach((step, stepIndex) => {
    if (
      step.type === 'navigate' &&
      step.url.kind === 'literal' &&
      typeof step.url.value === 'string'
    ) {
      const validation = validateNavigateUrl(step.url.value);
      if (!validation.valid) {
        issues.push({
          code: validation.code ?? 'NAVIGATE_URL_INVALID',
          message: 'Navigate URL is invalid or contains sensitive data.',
          path: ['steps', stepIndex, 'url'],
          stepId: step.id,
          stepIndex,
        });
      }
    }
  });

  for (const issue of analyzeWorkflowInputs(result.data).issues) {
    if (issue.severity !== 'blocking') {
      continue;
    }
    issues.push({
      code: issue.code,
      message: issue.message,
      path: issue.path,
      ...(issue.stepId === undefined ? {} : { stepId: issue.stepId }),
      ...(issue.stepIndex === undefined ? {} : { stepIndex: issue.stepIndex }),
    });
  }

  for (const issue of analyzeWorkflowVerifications(result.data).issues) {
    issues.push({
      code: issue.code,
      message: issue.message,
      path: issue.path,
      stepId: issue.stepId,
      stepIndex: issue.stepIndex,
    });
  }

  return issues;
}
