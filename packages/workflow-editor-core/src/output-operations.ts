import { analyzeWorkflowExtraction } from '@tasktwin/workflow-extraction';
import {
  IdentifierSchema,
  type ExtractStep,
  type ValueSource,
  type WorkflowDefinition,
  type WorkflowStep,
} from '@tasktwin/workflow-schema';

import {
  insertWorkflowStep,
  listReusableStepLocators,
} from './editor-operations.js';

export type WorkflowOutputOperationResult =
  | { ok: true; workflow: WorkflowDefinition }
  | {
      ok: false;
      error: {
        code:
          | 'OUTPUT_INVALID'
          | 'OUTPUT_NOT_FOUND'
          | 'OUTPUT_NAME_COLLISION'
          | 'OUTPUT_HAS_USAGES'
          | 'LOCATOR_NOT_FOUND';
        message: string;
        usageStepIds?: string[];
      };
    };

function replaceOutputSource(
  source: ValueSource,
  currentName: string,
  nextName: string,
): ValueSource {
  return source.kind === 'output' && source.outputName === currentName
    ? { kind: 'output', outputName: nextName }
    : source;
}

function renameReferences(
  step: WorkflowStep,
  currentName: string,
  nextName: string,
): WorkflowStep {
  if (step.type === 'navigate') {
    return {
      ...step,
      url: replaceOutputSource(step.url, currentName, nextName),
    };
  }
  if (step.type === 'fill' || step.type === 'select') {
    return {
      ...step,
      value: replaceOutputSource(step.value, currentName, nextName),
    };
  }
  if (
    step.type === 'verify' &&
    (step.assertion.kind === 'url' ||
      step.assertion.kind === 'text' ||
      step.assertion.kind === 'value')
  ) {
    return {
      ...step,
      assertion: {
        ...step.assertion,
        expected: replaceOutputSource(
          step.assertion.expected,
          currentName,
          nextName,
        ),
      },
    };
  }
  return step;
}

export function addUrlExtractStep(
  workflow: WorkflowDefinition,
  input: Pick<ExtractStep, 'id' | 'name' | 'outputName'> &
    Partial<Pick<ExtractStep, 'outputLabel' | 'timeoutMs'>>,
  index = workflow.steps.length,
): WorkflowDefinition {
  return insertWorkflowStep(workflow, index, {
    ...input,
    type: 'extract',
    source: { kind: 'url', mode: 'origin_and_path' },
    retention: 'ephemeral',
  });
}

export function addElementExtractStep(
  workflow: WorkflowDefinition,
  sourceStepId: string,
  input: Pick<ExtractStep, 'id' | 'name' | 'outputName'> &
    Partial<Pick<ExtractStep, 'outputLabel' | 'timeoutMs'>>,
  index = workflow.steps.length,
): WorkflowOutputOperationResult {
  const locator = listReusableStepLocators(workflow).find(
    (item) => item.stepId === sourceStepId,
  );
  if (locator === undefined) {
    return {
      ok: false,
      error: {
        code: 'LOCATOR_NOT_FOUND',
        message: 'Reusable locator was not found.',
      },
    };
  }
  const candidate = insertWorkflowStep(workflow, index, {
    ...input,
    type: 'extract',
    locator: { ...locator.locator },
    source: { kind: 'text' },
    retention: 'ephemeral',
  });
  return { ok: true, workflow: candidate };
}

export function renameWorkflowOutput(
  workflow: WorkflowDefinition,
  currentName: string,
  nextName: string,
): WorkflowOutputOperationResult {
  const producer = workflow.steps.find(
    (step) => step.type === 'extract' && step.outputName === currentName,
  );
  if (producer === undefined) {
    return {
      ok: false,
      error: {
        code: 'OUTPUT_NOT_FOUND',
        message: 'Workflow output was not found.',
      },
    };
  }
  if (!IdentifierSchema.safeParse(nextName).success) {
    return {
      ok: false,
      error: { code: 'OUTPUT_INVALID', message: 'Output name is invalid.' },
    };
  }
  if (
    currentName !== nextName &&
    workflow.steps.some(
      (step) => step.type === 'extract' && step.outputName === nextName,
    )
  ) {
    return {
      ok: false,
      error: {
        code: 'OUTPUT_NAME_COLLISION',
        message: 'Output name already exists.',
      },
    };
  }
  if (currentName === nextName) return { ok: true, workflow };
  return {
    ok: true,
    workflow: {
      ...workflow,
      steps: workflow.steps.map((step) => {
        const renamed =
          step.type === 'extract' && step.id === producer.id
            ? { ...step, outputName: nextName }
            : step;
        return renameReferences(renamed, currentName, nextName);
      }),
    },
  };
}

export function removeExtractStep(
  workflow: WorkflowDefinition,
  stepId: string,
): WorkflowOutputOperationResult {
  const candidate = workflow.steps.find((step) => step.id === stepId);
  if (candidate === undefined || candidate.type !== 'extract') {
    return {
      ok: false,
      error: {
        code: 'OUTPUT_NOT_FOUND',
        message: 'Extract step was not found.',
      },
    };
  }
  const producer = candidate;
  const analysis = analyzeWorkflowExtraction(workflow);
  const usages = analysis.usages.filter(
    (usage) => usage.outputName === producer.outputName,
  );
  if (usages.length > 0) {
    return {
      ok: false,
      error: {
        code: 'OUTPUT_HAS_USAGES',
        message: 'A referenced Extract step cannot be removed.',
        usageStepIds: usages.map((usage) => usage.consumerStepId),
      },
    };
  }
  return {
    ok: true,
    workflow: {
      ...workflow,
      steps: workflow.steps.filter((step) => step.id !== stepId),
    },
  };
}
