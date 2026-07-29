import type {
  LiteralValue,
  WorkflowVariableValueType,
} from '@tasktwin/workflow-schema';

import type { ValueSourceTarget } from './contracts.js';

export interface ValueSourceCompatibility {
  literalTypes: ReadonlyArray<'string' | 'number' | 'boolean'>;
  variableTypes: ReadonlyArray<WorkflowVariableValueType>;
  allowsSecret: boolean;
}

const compatibility: Record<ValueSourceTarget, ValueSourceCompatibility> = {
  'navigate.url': {
    literalTypes: ['string'],
    variableTypes: ['string'],
    allowsSecret: false,
  },
  'fill.value': {
    literalTypes: ['string'],
    variableTypes: ['string'],
    allowsSecret: true,
  },
  'select.value': {
    literalTypes: ['string', 'number'],
    variableTypes: ['string', 'number'],
    allowsSecret: false,
  },
  'verify.text.expected': {
    literalTypes: ['string'],
    variableTypes: ['string'],
    allowsSecret: false,
  },
  'verify.value.expected': {
    literalTypes: ['string', 'number', 'boolean'],
    variableTypes: ['string', 'number', 'boolean'],
    allowsSecret: false,
  },
  'verify.url.expected': {
    literalTypes: ['string'],
    variableTypes: ['string'],
    allowsSecret: false,
  },
};

export function getValueSourceCompatibility(
  target: ValueSourceTarget,
): ValueSourceCompatibility {
  return compatibility[target];
}

export function isVariableTypeCompatible(
  target: ValueSourceTarget,
  valueType: WorkflowVariableValueType,
): boolean {
  return compatibility[target].variableTypes.includes(valueType);
}

export function isLiteralCompatible(
  target: ValueSourceTarget,
  value: LiteralValue,
): boolean {
  const valueType: 'string' | 'number' | 'boolean' =
    typeof value === 'string'
      ? 'string'
      : typeof value === 'number'
        ? 'number'
        : 'boolean';
  return compatibility[target].literalTypes.includes(valueType);
}
