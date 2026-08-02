import {
  analyzeWorkflowInputs,
  findWorkflowValueSources,
  type ValueSourceTarget,
  type VariableUsage,
} from '@tasktwin/workflow-inputs';
import {
  IdentifierSchema,
  ValueSourceSchema,
  WorkflowVariableSchema,
  type ValueSource,
  type WorkflowDefinition,
  type WorkflowStep,
  type WorkflowVariable,
} from '@tasktwin/workflow-schema';
import { analyzeWorkflowExtraction } from '@tasktwin/workflow-extraction';

export type WorkflowVariableOperationErrorCode =
  | 'VARIABLE_INVALID'
  | 'VARIABLE_NOT_FOUND'
  | 'VARIABLE_NAME_COLLISION'
  | 'VARIABLE_HAS_USAGES'
  | 'VARIABLE_TYPE_INCOMPATIBLE'
  | 'STEP_NOT_FOUND'
  | 'VALUE_SOURCE_TARGET_MISMATCH'
  | 'VALUE_SOURCE_INVALID';

export interface WorkflowVariableOperationError {
  code: WorkflowVariableOperationErrorCode;
  message: string;
  variableName?: string;
  usages?: VariableUsage[];
}

export type WorkflowVariableOperationResult =
  | { ok: true; workflow: WorkflowDefinition }
  | { ok: false; error: WorkflowVariableOperationError };

function failure(
  code: WorkflowVariableOperationErrorCode,
  message: string,
  context: Omit<WorkflowVariableOperationError, 'code' | 'message'> = {},
): WorkflowVariableOperationResult {
  return { ok: false, error: { code, message, ...context } };
}

function success(
  workflow: WorkflowDefinition,
): WorkflowVariableOperationResult {
  return { ok: true, workflow };
}

export function findVariableUsages(
  workflow: WorkflowDefinition,
  variableName: string,
): VariableUsage[] {
  return findWorkflowValueSources(workflow)
    .filter(
      (located) =>
        located.source.kind === 'variable' &&
        located.source.variableName === variableName,
    )
    .map((located) => located.usage);
}

export function addVariable(
  workflow: WorkflowDefinition,
  variableInput: WorkflowVariable,
): WorkflowVariableOperationResult {
  const variable = WorkflowVariableSchema.safeParse(variableInput);
  if (!variable.success) {
    return failure('VARIABLE_INVALID', 'Workflow variable is invalid.');
  }
  if (workflow.variables.some((item) => item.name === variable.data.name)) {
    return failure(
      'VARIABLE_NAME_COLLISION',
      'A workflow variable with this name already exists.',
      { variableName: variable.data.name },
    );
  }

  return success({
    ...workflow,
    variables: [...workflow.variables, variable.data],
  });
}

export function updateVariable(
  workflow: WorkflowDefinition,
  variableName: string,
  replacementInput: WorkflowVariable,
): WorkflowVariableOperationResult {
  const index = workflow.variables.findIndex(
    (variable) => variable.name === variableName,
  );
  if (index === -1) {
    return failure('VARIABLE_NOT_FOUND', 'Workflow variable was not found.', {
      variableName,
    });
  }

  const replacement = WorkflowVariableSchema.safeParse(replacementInput);
  if (!replacement.success || replacement.data.name !== variableName) {
    return failure(
      'VARIABLE_INVALID',
      'Workflow variable update is invalid. Use rename for name changes.',
      { variableName },
    );
  }

  const variables = workflow.variables.slice();
  variables[index] = replacement.data;
  const candidate = { ...workflow, variables };
  const incompatible = analyzeWorkflowInputs(candidate).issues.filter(
    (issue) =>
      issue.code === 'INCOMPATIBLE_VARIABLE_TYPE' &&
      issue.variableName === variableName,
  );
  if (incompatible.length > 0) {
    return failure(
      'VARIABLE_TYPE_INCOMPATIBLE',
      'Variable type is incompatible with one or more usages.',
      {
        variableName,
        usages: findVariableUsages(workflow, variableName),
      },
    );
  }

  return success(candidate);
}

function renameSource(
  source: ValueSource,
  currentName: string,
  nextName: string,
): ValueSource {
  return source.kind === 'variable' && source.variableName === currentName
    ? { kind: 'variable', variableName: nextName }
    : source;
}

function renameStepReferences(
  step: WorkflowStep,
  currentName: string,
  nextName: string,
): WorkflowStep {
  switch (step.type) {
    case 'navigate':
      return {
        ...step,
        url: renameSource(step.url, currentName, nextName),
      };
    case 'fill':
    case 'select':
      return {
        ...step,
        value: renameSource(step.value, currentName, nextName),
      };
    case 'verify':
      if (
        step.assertion.kind === 'text' ||
        step.assertion.kind === 'value' ||
        step.assertion.kind === 'url'
      ) {
        return {
          ...step,
          assertion: {
            ...step.assertion,
            expected: renameSource(
              step.assertion.expected,
              currentName,
              nextName,
            ),
          },
        };
      }
      return step;
    default:
      return step;
  }
}

export function renameVariable(
  workflow: WorkflowDefinition,
  currentName: string,
  nextName: string,
): WorkflowVariableOperationResult {
  const currentIndex = workflow.variables.findIndex(
    (variable) => variable.name === currentName,
  );
  if (currentIndex === -1) {
    return failure('VARIABLE_NOT_FOUND', 'Workflow variable was not found.', {
      variableName: currentName,
    });
  }
  if (!IdentifierSchema.safeParse(nextName).success) {
    return failure('VARIABLE_INVALID', 'New variable name is invalid.');
  }
  if (
    currentName !== nextName &&
    workflow.variables.some((variable) => variable.name === nextName)
  ) {
    return failure(
      'VARIABLE_NAME_COLLISION',
      'A workflow variable with this name already exists.',
      { variableName: nextName },
    );
  }
  if (currentName === nextName) {
    return success(workflow);
  }

  const variables = workflow.variables.map((variable, index) =>
    index === currentIndex ? { ...variable, name: nextName } : variable,
  );
  const steps = workflow.steps.map((step) =>
    renameStepReferences(step, currentName, nextName),
  );
  return success({ ...workflow, variables, steps });
}

export function removeVariable(
  workflow: WorkflowDefinition,
  variableName: string,
): WorkflowVariableOperationResult {
  if (!workflow.variables.some((variable) => variable.name === variableName)) {
    return failure('VARIABLE_NOT_FOUND', 'Workflow variable was not found.', {
      variableName,
    });
  }

  const usages = findVariableUsages(workflow, variableName);
  if (usages.length > 0) {
    return failure(
      'VARIABLE_HAS_USAGES',
      'Referenced workflow variables cannot be removed.',
      { variableName, usages },
    );
  }

  return success({
    ...workflow,
    variables: workflow.variables.filter(
      (variable) => variable.name !== variableName,
    ),
  });
}

function replaceStepValueSource(
  step: WorkflowStep,
  target: ValueSourceTarget,
  source: ValueSource,
): WorkflowStep | null {
  if (step.type === 'navigate' && target === 'navigate.url') {
    return { ...step, url: source };
  }
  if (step.type === 'fill' && target === 'fill.value') {
    return { ...step, value: source };
  }
  if (step.type === 'select' && target === 'select.value') {
    return { ...step, value: source };
  }
  if (step.type !== 'verify') {
    return null;
  }

  if (step.assertion.kind === 'text' && target === 'verify.text.expected') {
    return { ...step, assertion: { ...step.assertion, expected: source } };
  }
  if (step.assertion.kind === 'value' && target === 'verify.value.expected') {
    return { ...step, assertion: { ...step.assertion, expected: source } };
  }
  if (step.assertion.kind === 'url' && target === 'verify.url.expected') {
    return { ...step, assertion: { ...step.assertion, expected: source } };
  }
  return null;
}

export function updateStepValueSource(
  workflow: WorkflowDefinition,
  stepId: string,
  target: ValueSourceTarget,
  sourceInput: ValueSource,
): WorkflowVariableOperationResult {
  const source = ValueSourceSchema.safeParse(sourceInput);
  if (!source.success) {
    return failure('VALUE_SOURCE_INVALID', 'Value source is invalid.');
  }
  const stepIndex = workflow.steps.findIndex((step) => step.id === stepId);
  if (stepIndex === -1) {
    return failure('STEP_NOT_FOUND', 'Workflow step was not found.');
  }

  const currentStep = workflow.steps[stepIndex];
  if (currentStep === undefined) {
    return failure('STEP_NOT_FOUND', 'Workflow step was not found.');
  }
  const replacement = replaceStepValueSource(currentStep, target, source.data);
  if (replacement === null) {
    return failure(
      'VALUE_SOURCE_TARGET_MISMATCH',
      'Value source target does not match the selected step.',
    );
  }

  const steps = workflow.steps.slice();
  steps[stepIndex] = replacement;
  const candidate = { ...workflow, steps };
  const blockingIssues = analyzeWorkflowInputs(candidate).issues.filter(
    (issue) => issue.severity === 'blocking',
  );
  const extractionIssues = analyzeWorkflowExtraction(candidate).issues.filter(
    (issue) => issue.severity === 'blocking',
  );
  if (blockingIssues.length > 0 || extractionIssues.length > 0) {
    return failure(
      source.data.kind === 'variable'
        ? 'VARIABLE_TYPE_INCOMPATIBLE'
        : 'VALUE_SOURCE_INVALID',
      'Value source is incompatible with this step property.',
      source.data.kind === 'variable'
        ? {
            variableName: source.data.variableName,
            usages: findVariableUsages(candidate, source.data.variableName),
          }
        : {},
    );
  }

  return success(candidate);
}
