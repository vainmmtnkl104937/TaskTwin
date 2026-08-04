import {
  ElementLocatorSchema,
  WorkflowDefinitionSchema,
  type ElementLocator,
  type WorkflowDefinition,
  type WorkflowStep,
} from '@tasktwin/workflow-schema';

export function locatorForWorkflowStep(
  step: WorkflowStep,
): ElementLocator | null {
  if (step.type === 'verify') {
    return 'locator' in step.assertion ? step.assertion.locator : null;
  }
  return 'locator' in step && step.locator !== undefined ? step.locator : null;
}

export type LocatorPatchResult =
  | { ok: true; workflow: WorkflowDefinition }
  | { ok: false; reason: 'STEP_NOT_FOUND' | 'ELEMENT_LOCATOR_REQUIRED' };

export function replaceWorkflowStepLocator(
  workflowInput: WorkflowDefinition,
  stepId: string,
  locatorInput: ElementLocator,
): LocatorPatchResult {
  const workflow = WorkflowDefinitionSchema.parse(workflowInput);
  const locator = ElementLocatorSchema.parse(locatorInput);
  const index = workflow.steps.findIndex((step) => step.id === stepId);
  const step = workflow.steps[index];
  if (step === undefined) return { ok: false, reason: 'STEP_NOT_FOUND' };
  if (locatorForWorkflowStep(step) === null) {
    return { ok: false, reason: 'ELEMENT_LOCATOR_REQUIRED' };
  }
  let replacement: WorkflowStep;
  if (step.type === 'verify' && 'locator' in step.assertion) {
    replacement = {
      ...step,
      assertion: { ...step.assertion, locator },
    };
  } else if ('locator' in step && step.locator !== undefined) {
    replacement = { ...step, locator };
  } else {
    return { ok: false, reason: 'ELEMENT_LOCATOR_REQUIRED' };
  }
  const steps = workflow.steps.slice();
  steps[index] = replacement;
  return {
    ok: true,
    workflow: WorkflowDefinitionSchema.parse({ ...workflow, steps }),
  };
}
