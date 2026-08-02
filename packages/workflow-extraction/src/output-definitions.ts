import type {
  ExtractStep,
  WorkflowDefinition,
} from '@tasktwin/workflow-schema';

import type {
  WorkflowOutputDefinition,
  WorkflowOutputType,
} from './contracts.js';

export function outputTypeForExtractStep(
  step: ExtractStep,
): WorkflowOutputType | null {
  switch (step.source.kind) {
    case 'text':
    case 'value':
    case 'url':
      return 'string';
    case 'checked':
      return 'boolean';
    case 'attribute':
      return null;
  }
}

export function defineWorkflowOutputs(
  workflow: Pick<WorkflowDefinition, 'steps'>,
): WorkflowOutputDefinition[] {
  return workflow.steps.flatMap((step, producerStepIndex) => {
    if (step.type !== 'extract') return [];
    const valueType = outputTypeForExtractStep(step);
    if (valueType === null) return [];
    return [
      {
        name: step.outputName,
        ...(step.outputLabel === undefined ? {} : { label: step.outputLabel }),
        valueType,
        retention: 'ephemeral' as const,
        producerStepId: step.id,
        producerStepIndex,
      },
    ];
  });
}
