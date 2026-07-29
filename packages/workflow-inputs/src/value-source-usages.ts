import type {
  ValueSource,
  WorkflowDefinition,
  WorkflowStep,
} from '@tasktwin/workflow-schema';

import { getValueSourceCompatibility } from './compatibility.js';
import type { ValueSourceTarget, VariableUsage } from './contracts.js';

export interface LocatedValueSource {
  source: ValueSource;
  usage: VariableUsage;
}

function locate(
  source: ValueSource,
  step: WorkflowStep,
  stepIndex: number,
  target: ValueSourceTarget,
  path: Array<string | number>,
): LocatedValueSource {
  return {
    source,
    usage: {
      stepId: step.id,
      stepIndex,
      stepType: step.type,
      target,
      path,
      acceptedVariableTypes: [
        ...getValueSourceCompatibility(target).variableTypes,
      ],
    },
  };
}

export function findWorkflowValueSources(
  workflow: Pick<WorkflowDefinition, 'steps'>,
): LocatedValueSource[] {
  return workflow.steps.flatMap((step, stepIndex) => {
    switch (step.type) {
      case 'navigate':
        return [
          locate(step.url, step, stepIndex, 'navigate.url', [
            'steps',
            stepIndex,
            'url',
          ]),
        ];
      case 'fill':
        return [
          locate(step.value, step, stepIndex, 'fill.value', [
            'steps',
            stepIndex,
            'value',
          ]),
        ];
      case 'select':
        return [
          locate(step.value, step, stepIndex, 'select.value', [
            'steps',
            stepIndex,
            'value',
          ]),
        ];
      case 'verify':
        switch (step.assertion.kind) {
          case 'text':
            return [
              locate(
                step.assertion.expected,
                step,
                stepIndex,
                'verify.text.expected',
                ['steps', stepIndex, 'assertion', 'expected'],
              ),
            ];
          case 'value':
            return [
              locate(
                step.assertion.expected,
                step,
                stepIndex,
                'verify.value.expected',
                ['steps', stepIndex, 'assertion', 'expected'],
              ),
            ];
          case 'url':
            return [
              locate(
                step.assertion.expected,
                step,
                stepIndex,
                'verify.url.expected',
                ['steps', stepIndex, 'assertion', 'expected'],
              ),
            ];
          default:
            return [];
        }
      default:
        return [];
    }
  });
}
