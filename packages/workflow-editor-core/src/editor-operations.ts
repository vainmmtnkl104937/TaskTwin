import type {
  ApprovalStep,
  WaitStep,
  WorkflowDefinition,
  WorkflowStep,
} from '@tasktwin/workflow-schema';

export interface WorkflowMetadataUpdate {
  name?: string;
  description?: string | undefined;
}

function replaceSteps(
  workflow: WorkflowDefinition,
  steps: WorkflowStep[],
): WorkflowDefinition {
  return {
    ...workflow,
    steps,
  };
}

export function updateWorkflowMetadata(
  workflow: WorkflowDefinition,
  update: WorkflowMetadataUpdate,
): WorkflowDefinition {
  const next = {
    ...workflow,
    ...(update.name === undefined ? {} : { name: update.name }),
  };

  if (!Object.hasOwn(update, 'description')) {
    return next;
  }

  if (update.description === undefined) {
    const withoutDescription = { ...next };
    delete withoutDescription.description;
    return withoutDescription;
  }

  return {
    ...next,
    description: update.description,
  };
}

export function updateWorkflowStep(
  workflow: WorkflowDefinition,
  stepId: string,
  replacement: WorkflowStep,
): WorkflowDefinition {
  const index = workflow.steps.findIndex((step) => step.id === stepId);
  if (index === -1) {
    throw new Error(`Workflow step not found: ${stepId}`);
  }

  const steps = workflow.steps.slice();
  steps[index] = replacement;
  return replaceSteps(workflow, steps);
}

export function insertWorkflowStep(
  workflow: WorkflowDefinition,
  index: number,
  step: WorkflowStep,
): WorkflowDefinition {
  if (!Number.isInteger(index) || index < 0 || index > workflow.steps.length) {
    throw new RangeError('Workflow step insertion index is out of bounds.');
  }

  const steps = workflow.steps.slice();
  steps.splice(index, 0, step);
  return replaceSteps(workflow, steps);
}

export function addWaitStep(
  workflow: WorkflowDefinition,
  input: Omit<WaitStep, 'type'>,
  index = workflow.steps.length,
): WorkflowDefinition {
  return insertWorkflowStep(workflow, index, {
    ...input,
    type: 'wait',
  });
}

export function addApprovalStep(
  workflow: WorkflowDefinition,
  input: Omit<ApprovalStep, 'type'>,
  index = workflow.steps.length,
): WorkflowDefinition {
  return insertWorkflowStep(workflow, index, {
    ...input,
    type: 'approval',
  });
}

export function removeWorkflowStep(
  workflow: WorkflowDefinition,
  stepId: string,
): WorkflowDefinition {
  const index = workflow.steps.findIndex((step) => step.id === stepId);
  if (index === -1) {
    throw new Error(`Workflow step not found: ${stepId}`);
  }

  return replaceSteps(workflow, [
    ...workflow.steps.slice(0, index),
    ...workflow.steps.slice(index + 1),
  ]);
}

function moveWorkflowStep(
  workflow: WorkflowDefinition,
  stepId: string,
  offset: -1 | 1,
): WorkflowDefinition {
  const index = workflow.steps.findIndex((step) => step.id === stepId);
  if (index === -1) {
    throw new Error(`Workflow step not found: ${stepId}`);
  }

  const destination = index + offset;
  if (destination < 0 || destination >= workflow.steps.length) {
    return workflow;
  }

  const steps = workflow.steps.slice();
  const selected = steps[index];
  const adjacent = steps[destination];
  if (selected === undefined || adjacent === undefined) {
    return workflow;
  }

  steps[index] = adjacent;
  steps[destination] = selected;
  return replaceSteps(workflow, steps);
}

export function moveWorkflowStepUp(
  workflow: WorkflowDefinition,
  stepId: string,
): WorkflowDefinition {
  return moveWorkflowStep(workflow, stepId, -1);
}

export function moveWorkflowStepDown(
  workflow: WorkflowDefinition,
  stepId: string,
): WorkflowDefinition {
  return moveWorkflowStep(workflow, stepId, 1);
}
