import {
  isLiteralCompatible,
  isVariableTypeCompatible,
  type ValueSourceTarget,
} from '@tasktwin/workflow-inputs';
import type {
  ValueSource,
  VerifyStep,
  WorkflowDefinition,
  WorkflowVariable,
} from '@tasktwin/workflow-schema';

import {
  MAX_VERIFICATION_FIELD_VALUE_LENGTH,
  MAX_VERIFICATION_TEXT_LENGTH,
} from './constants.js';
import {
  WorkflowVerificationAnalysisSchema,
  type VerificationAnalysisIssue,
  type WorkflowVerificationAnalysis,
} from './contracts.js';
import { normalizeVerificationUrl } from './url-normalization.js';

export function textMatchMode(step: VerifyStep): 'exact' | 'contains' | null {
  if (step.assertion.kind !== 'text') return null;
  if (step.assertion.matchMode !== undefined) return step.assertion.matchMode;
  return step.assertion.operator === 'equals' ? 'exact' : 'contains';
}

export function urlMatchMode(
  step: VerifyStep,
): 'origin' | 'origin_and_path' | null {
  if (step.assertion.kind !== 'url') return null;
  if (step.assertion.matchMode !== undefined) return step.assertion.matchMode;
  return step.assertion.operator === 'equals' ? 'origin_and_path' : null;
}

function expectedSource(step: VerifyStep): {
  source: ValueSource;
  target: ValueSourceTarget;
} | null {
  switch (step.assertion.kind) {
    case 'url':
      return { source: step.assertion.expected, target: 'verify.url.expected' };
    case 'text':
      return {
        source: step.assertion.expected,
        target: 'verify.text.expected',
      };
    case 'value':
      return {
        source: step.assertion.expected,
        target: 'verify.value.expected',
      };
    default:
      return null;
  }
}

function issue(
  step: VerifyStep,
  stepIndex: number,
  code: VerificationAnalysisIssue['code'],
  message: string,
  suffix: Array<string | number> = [],
): VerificationAnalysisIssue {
  return {
    code,
    message,
    path: ['steps', stepIndex, 'assertion', ...suffix],
    stepId: step.id,
    stepIndex,
  };
}

function variableByName(
  variables: readonly WorkflowVariable[],
  name: string,
): WorkflowVariable | undefined {
  return variables.find((variable) => variable.name === name);
}

function analyzeExpected(
  step: VerifyStep,
  stepIndex: number,
  variables: readonly WorkflowVariable[],
): VerificationAnalysisIssue[] {
  const expected = expectedSource(step);
  if (expected === null) return [];
  const { source, target } = expected;
  if (source.kind === 'secret') {
    return [
      issue(
        step,
        stepIndex,
        'VERIFICATION_SECRET_EXPECTATION_FORBIDDEN',
        'Verification cannot use a secret expectation.',
        ['expected'],
      ),
    ];
  }
  if (source.kind === 'variable') {
    const variable = variableByName(variables, source.variableName);
    if (variable?.valueType === 'file') {
      return [
        issue(
          step,
          stepIndex,
          'VERIFICATION_FILE_EXPECTATION_FORBIDDEN',
          'Verification cannot use a file expectation.',
          ['expected'],
        ),
      ];
    }
    if (
      variable !== undefined &&
      !isVariableTypeCompatible(target, variable.valueType)
    ) {
      return [
        issue(
          step,
          stepIndex,
          'VERIFICATION_EXPECTATION_TYPE_INCOMPATIBLE',
          'The verification variable type is incompatible.',
          ['expected'],
        ),
      ];
    }
    return [];
  }
  // Output producer ordering and type compatibility are validated by
  // @tasktwin/workflow-extraction. Verification keeps the shared source valid.
  if (source.kind === 'output') return [];
  if (!isLiteralCompatible(target, source.value)) {
    return [
      issue(
        step,
        stepIndex,
        'VERIFICATION_EXPECTATION_TYPE_INCOMPATIBLE',
        'The verification literal type is incompatible.',
        ['expected'],
      ),
    ];
  }
  if (typeof source.value !== 'string') return [];
  const maximum =
    target === 'verify.value.expected'
      ? MAX_VERIFICATION_FIELD_VALUE_LENGTH
      : MAX_VERIFICATION_TEXT_LENGTH;
  if (source.value.length > maximum) {
    return [
      issue(
        step,
        stepIndex,
        'VERIFICATION_EXPECTATION_TOO_LONG',
        'The verification expectation exceeds its safe length limit.',
        ['expected'],
      ),
    ];
  }
  if (target === 'verify.url.expected') {
    const normalized = normalizeVerificationUrl(source.value);
    if (!normalized.ok) {
      return [
        issue(
          step,
          stepIndex,
          normalized.code === 'unsafe'
            ? 'VERIFICATION_URL_UNSAFE'
            : 'VERIFICATION_URL_INVALID',
          'The verification URL is invalid or unsafe.',
          ['expected'],
        ),
      ];
    }
  }
  return [];
}

export function analyzeWorkflowVerifications(
  workflow: WorkflowDefinition,
): WorkflowVerificationAnalysis {
  const issues: VerificationAnalysisIssue[] = [];
  let verificationStepCount = 0;
  workflow.steps.forEach((candidate, stepIndex) => {
    if (candidate.type !== 'verify') return;
    verificationStepCount += 1;
    if (
      candidate.assertion.kind === 'url' &&
      urlMatchMode(candidate) === null
    ) {
      issues.push(
        issue(
          candidate,
          stepIndex,
          'VERIFICATION_LEGACY_OPERATOR_UNSUPPORTED',
          'Legacy URL contains verification must select a safe URL match mode.',
          ['operator'],
        ),
      );
    }
    if (
      candidate.assertion.kind === 'value' &&
      candidate.assertion.operator === 'contains'
    ) {
      issues.push(
        issue(
          candidate,
          stepIndex,
          'VERIFICATION_LEGACY_OPERATOR_UNSUPPORTED',
          'Field-value verification supports exact comparison only.',
          ['operator'],
        ),
      );
    }
    issues.push(...analyzeExpected(candidate, stepIndex, workflow.variables));
  });
  return WorkflowVerificationAnalysisSchema.parse({
    schemaVersion: 1,
    verificationStepCount,
    hasValidVerification:
      verificationStepCount > 0 &&
      workflow.steps.some(
        (step) =>
          step.type === 'verify' &&
          !issues.some((item) => item.stepId === step.id),
      ),
    issues,
  });
}
