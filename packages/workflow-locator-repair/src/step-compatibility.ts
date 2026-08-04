import type { WorkflowStep } from '@tasktwin/workflow-schema';

import type { LocatorRepairElementKind } from './contracts.js';

export function isLocatorCompatibleWithStep(
  step: WorkflowStep,
  elementKind: LocatorRepairElementKind,
): boolean {
  switch (step.type) {
    case 'click':
      return elementKind !== 'text_input' && elementKind !== 'select';
    case 'fill':
      return elementKind === 'text_input';
    case 'select':
      return elementKind === 'select';
    case 'setChecked':
      return elementKind === 'checkbox' || elementKind === 'radio';
    case 'verify':
      switch (step.assertion.kind) {
        case 'url':
          return false;
        case 'value':
          return elementKind === 'text_input' || elementKind === 'select';
        case 'checked':
          return elementKind === 'checkbox' || elementKind === 'radio';
        default:
          return true;
      }
    case 'extract':
      switch (step.source.kind) {
        case 'url':
        case 'attribute':
          return false;
        case 'value':
          return elementKind === 'text_input' || elementKind === 'select';
        case 'checked':
          return elementKind === 'checkbox' || elementKind === 'radio';
        case 'text':
          return true;
      }
    default:
      return false;
  }
}
