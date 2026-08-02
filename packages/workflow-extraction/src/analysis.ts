import { findWorkflowValueSources } from '@tasktwin/workflow-inputs';
import {
  WorkflowDefinitionSchema,
  type WorkflowDefinition,
} from '@tasktwin/workflow-schema';

import { isOutputTypeCompatible } from './compatibility.js';
import {
  WORKFLOW_EXTRACTION_SCHEMA_VERSION,
  WorkflowExtractionAnalysisSchema,
  type ExtractionAnalysisIssue,
  type ExtractionIssueCode,
  type WorkflowExtractionAnalysis,
  type WorkflowOutputUsage,
} from './contracts.js';
import {
  defineWorkflowOutputs,
  outputTypeForExtractStep,
} from './output-definitions.js';

const messages: Record<ExtractionIssueCode, string> = {
  INVALID_WORKFLOW_DEFINITION: 'Workflow definition is invalid.',
  INVALID_EXTRACT_STEP: 'Extract step is invalid.',
  UNSUPPORTED_EXTRACTION_SOURCE: 'Extraction source is not supported.',
  DUPLICATE_OUTPUT_NAME: 'Workflow output names must be unique.',
  UNKNOWN_OUTPUT_REFERENCE: 'Referenced workflow output does not exist.',
  OUTPUT_REFERENCE_BEFORE_PRODUCER:
    'Workflow output must be produced before it is referenced.',
  OUTPUT_SELF_REFERENCE: 'An Extract step cannot reference its own output.',
  OUTPUT_TYPE_INCOMPATIBLE:
    'Workflow output type is incompatible with this step property.',
  OUTPUT_NAVIGATE_FORBIDDEN: 'Navigate cannot use a workflow output.',
  PASSWORD_EXTRACTION_FORBIDDEN: 'Password values cannot be extracted.',
  UNUSED_OUTPUT: 'Workflow output is not referenced by a later step.',
};

function issue(
  code: ExtractionIssueCode,
  severity: 'blocking' | 'warning',
  path: Array<string | number>,
  metadata: Partial<
    Pick<ExtractionAnalysisIssue, 'stepId' | 'stepIndex' | 'outputName'>
  > = {},
): ExtractionAnalysisIssue {
  return { code, severity, message: messages[code], path, ...metadata };
}

function invalidAnalysis(): WorkflowExtractionAnalysis {
  return WorkflowExtractionAnalysisSchema.parse({
    schemaVersion: WORKFLOW_EXTRACTION_SCHEMA_VERSION,
    outputs: [],
    usages: [],
    issues: [issue('INVALID_WORKFLOW_DEFINITION', 'blocking', [])],
    hasBlockingIssues: true,
  });
}

function deterministicSort(
  left: ExtractionAnalysisIssue,
  right: ExtractionAnalysisIssue,
): number {
  const leftIndex = left.stepIndex ?? Number.MAX_SAFE_INTEGER;
  const rightIndex = right.stepIndex ?? Number.MAX_SAFE_INTEGER;
  if (leftIndex !== rightIndex) return leftIndex - rightIndex;
  const pathComparison = JSON.stringify(left.path).localeCompare(
    JSON.stringify(right.path),
  );
  if (pathComparison !== 0) return pathComparison;
  const codeComparison = left.code.localeCompare(right.code);
  if (codeComparison !== 0) return codeComparison;
  return (left.outputName ?? '').localeCompare(right.outputName ?? '');
}

export function analyzeWorkflowExtraction(
  input: unknown,
): WorkflowExtractionAnalysis {
  const parsed = WorkflowDefinitionSchema.safeParse(input);
  if (!parsed.success) return invalidAnalysis();
  const workflow: WorkflowDefinition = parsed.data;
  const outputs = defineWorkflowOutputs(workflow);
  const producerByName = new Map<string, (typeof outputs)[number]>();
  const issues: ExtractionAnalysisIssue[] = [];

  workflow.steps.forEach((step, stepIndex) => {
    if (step.type !== 'extract') return;
    const outputType = outputTypeForExtractStep(step);
    if (outputType === null) {
      issues.push(
        issue(
          'UNSUPPORTED_EXTRACTION_SOURCE',
          'blocking',
          ['steps', stepIndex, 'source'],
          { stepId: step.id, stepIndex, outputName: step.outputName },
        ),
      );
      return;
    }
    const definition = outputs.find(
      (output) => output.producerStepIndex === stepIndex,
    );
    if (definition === undefined) return;
    if (producerByName.has(definition.name)) {
      issues.push(
        issue(
          'DUPLICATE_OUTPUT_NAME',
          'blocking',
          ['steps', stepIndex, 'outputName'],
          { stepId: step.id, stepIndex, outputName: definition.name },
        ),
      );
    } else {
      producerByName.set(definition.name, definition);
    }
  });

  const usages: WorkflowOutputUsage[] = [];
  for (const located of findWorkflowValueSources(workflow)) {
    if (located.source.kind !== 'output') continue;
    const usage: WorkflowOutputUsage = {
      outputName: located.source.outputName,
      consumerStepId: located.usage.stepId,
      consumerStepIndex: located.usage.stepIndex,
      target: located.usage.target,
      path: located.usage.path,
    };
    usages.push(usage);
    const producer = producerByName.get(usage.outputName);
    if (usage.target === 'navigate.url') {
      issues.push(
        issue('OUTPUT_NAVIGATE_FORBIDDEN', 'blocking', usage.path, {
          stepId: usage.consumerStepId,
          stepIndex: usage.consumerStepIndex,
          outputName: usage.outputName,
        }),
      );
    }
    if (producer === undefined) {
      issues.push(
        issue('UNKNOWN_OUTPUT_REFERENCE', 'blocking', usage.path, {
          stepId: usage.consumerStepId,
          stepIndex: usage.consumerStepIndex,
          outputName: usage.outputName,
        }),
      );
      continue;
    }
    if (producer.producerStepIndex === usage.consumerStepIndex) {
      issues.push(
        issue('OUTPUT_SELF_REFERENCE', 'blocking', usage.path, {
          stepId: usage.consumerStepId,
          stepIndex: usage.consumerStepIndex,
          outputName: usage.outputName,
        }),
      );
    } else if (producer.producerStepIndex > usage.consumerStepIndex) {
      issues.push(
        issue('OUTPUT_REFERENCE_BEFORE_PRODUCER', 'blocking', usage.path, {
          stepId: usage.consumerStepId,
          stepIndex: usage.consumerStepIndex,
          outputName: usage.outputName,
        }),
      );
    }
    if (!isOutputTypeCompatible(usage.target, producer.valueType)) {
      issues.push(
        issue('OUTPUT_TYPE_INCOMPATIBLE', 'blocking', usage.path, {
          stepId: usage.consumerStepId,
          stepIndex: usage.consumerStepIndex,
          outputName: usage.outputName,
        }),
      );
    }
  }

  for (const output of outputs) {
    if (!usages.some((usage) => usage.outputName === output.name)) {
      issues.push(
        issue(
          'UNUSED_OUTPUT',
          'warning',
          ['steps', output.producerStepIndex, 'outputName'],
          {
            stepId: output.producerStepId,
            stepIndex: output.producerStepIndex,
            outputName: output.name,
          },
        ),
      );
    }
  }

  issues.sort(deterministicSort);
  return WorkflowExtractionAnalysisSchema.parse({
    schemaVersion: WORKFLOW_EXTRACTION_SCHEMA_VERSION,
    outputs,
    usages,
    issues,
    hasBlockingIssues: issues.some((item) => item.severity === 'blocking'),
  });
}
