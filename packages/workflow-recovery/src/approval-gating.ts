import type { WorkflowDefinition } from '@tasktwin/workflow-schema';

export function isApprovalGatedStep(
  workflow: WorkflowDefinition,
  stepId: string,
): boolean {
  const index = workflow.steps.findIndex((step) => step.id === stepId);
  return index > 0 && workflow.steps[index - 1]?.type === 'approval';
}
