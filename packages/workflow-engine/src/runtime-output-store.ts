import type {
  SafeWorkflowOutputSummary,
  WorkflowOutputDefinition,
  WorkflowOutputType,
} from '@tasktwin/workflow-extraction';

import { SafeExecutionException } from './errors.js';

type RuntimeOutputValue = string | boolean;

export class RuntimeOutputStore {
  private readonly values = new Map<
    string,
    { type: WorkflowOutputType; value: RuntimeOutputValue }
  >();

  constructor(
    private readonly definitions: readonly WorkflowOutputDefinition[],
  ) {}

  set(
    outputName: string,
    outputType: WorkflowOutputType,
    value: RuntimeOutputValue,
  ): void {
    const definition = this.definitions.find(
      (item) => item.name === outputName,
    );
    if (definition === undefined) {
      throw new SafeExecutionException('OUTPUT_NOT_AVAILABLE');
    }
    if (this.values.has(outputName)) {
      throw new SafeExecutionException('DUPLICATE_OUTPUT_PRODUCTION');
    }
    if (
      definition.valueType !== outputType ||
      typeof value !== definition.valueType
    ) {
      throw new SafeExecutionException('OUTPUT_TYPE_MISMATCH');
    }
    this.values.set(outputName, { type: outputType, value });
  }

  get(
    outputName: string,
    acceptedTypes: readonly string[],
  ): RuntimeOutputValue {
    const stored = this.values.get(outputName);
    if (stored === undefined) {
      throw new SafeExecutionException('OUTPUT_NOT_AVAILABLE');
    }
    if (!acceptedTypes.includes(stored.type)) {
      throw new SafeExecutionException('OUTPUT_TYPE_MISMATCH');
    }
    return stored.value;
  }

  summaries(): SafeWorkflowOutputSummary[] {
    return this.definitions.map((definition) => ({
      outputName: definition.name,
      outputType: definition.valueType,
      producerStepId: definition.producerStepId,
      status: this.values.has(definition.name) ? 'produced' : 'not_produced',
    }));
  }

  clear(): void {
    this.values.clear();
  }

  get size(): number {
    return this.values.size;
  }
}
