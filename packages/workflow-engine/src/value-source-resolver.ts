import type { ValueSource } from '@tasktwin/workflow-schema';
import {
  getValueSourceCompatibility,
  type RuntimeInputValue,
  type ValueSourceTarget,
} from '@tasktwin/workflow-inputs';

import { SafeExecutionException } from './errors.js';

export type RuntimeValueRecord = Readonly<Record<string, RuntimeInputValue>>;

export function resolveValueSource(
  source: ValueSource,
  target: ValueSourceTarget,
  runtimeValues: RuntimeValueRecord,
): string | number | boolean {
  const compatibility = getValueSourceCompatibility(target);
  if (source.kind === 'secret') {
    throw new SafeExecutionException('SECRET_RESOLUTION_UNAVAILABLE');
  }
  if (source.kind === 'literal') {
    const literalType = typeof source.value as 'string' | 'number' | 'boolean';
    if (!compatibility.literalTypes.includes(literalType)) {
      throw new SafeExecutionException('INVALID_WORKFLOW');
    }
    return source.value;
  }
  const runtimeValue = runtimeValues[source.variableName];
  if (
    runtimeValue === undefined ||
    !compatibility.variableTypes.includes(runtimeValue.kind)
  ) {
    throw new SafeExecutionException('INVALID_RUNTIME_INPUTS');
  }
  if (runtimeValue.kind === 'file') {
    throw new SafeExecutionException('INVALID_RUNTIME_INPUTS');
  }
  return runtimeValue.value;
}

export function resolveTextValue(
  source: ValueSource,
  target: 'navigate.url' | 'fill.value',
  runtimeValues: RuntimeValueRecord,
): string {
  const value = resolveValueSource(source, target, runtimeValues);
  if (typeof value !== 'string') {
    throw new SafeExecutionException('INVALID_RUNTIME_INPUTS');
  }
  return value;
}

export function resolveSelectValue(
  source: ValueSource,
  runtimeValues: RuntimeValueRecord,
): string {
  const value = resolveValueSource(source, 'select.value', runtimeValues);
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new SafeExecutionException('INVALID_RUNTIME_INPUTS');
  }
  return String(value);
}
