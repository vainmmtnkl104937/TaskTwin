import { getValueSourceCompatibility } from '@tasktwin/workflow-inputs';
import type { ValueSourceTarget } from '@tasktwin/workflow-inputs';

import type { WorkflowOutputType } from './contracts.js';

export function isOutputTypeCompatible(
  target: ValueSourceTarget,
  outputType: WorkflowOutputType,
): boolean {
  if (target === 'navigate.url') return false;
  return getValueSourceCompatibility(target).variableTypes.includes(outputType);
}
