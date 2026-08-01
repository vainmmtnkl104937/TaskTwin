import {
  analyzeWorkflowInputs,
  WorkflowRunInputSubmissionSchema,
  type WorkflowRunInputSubmission,
} from '@tasktwin/workflow-inputs';

import {
  SecureRunInputManifestSchema,
  type SecureRunInputManifest,
} from './contracts.js';
import { SecureRunInputError } from './errors.js';

export function deriveSecureRunInputManifest(
  input: unknown,
): SecureRunInputManifest {
  const analysis = analyzeWorkflowInputs(input);
  if (analysis.hasBlockingIssues) {
    throw new SecureRunInputError('RUNTIME_INPUTS_INVALID');
  }
  const fileRequired = analysis.variables.some(
    ({ variable, usageCount }) =>
      variable.valueType === 'file' && (variable.required || usageCount > 0),
  );
  if (fileRequired) {
    throw new SecureRunInputError('FILE_INPUT_UNAVAILABLE');
  }
  return SecureRunInputManifestSchema.parse({
    schemaVersion: 1,
    variables: analysis.variables
      .filter(
        ({ variable, usageCount }) =>
          variable.valueType !== 'file' &&
          (variable.required || usageCount > 0),
      )
      .map(({ variable, usageCount }) => ({
        name: variable.name,
        ...(variable.label === undefined ? {} : { label: variable.label }),
        valueType: variable.valueType,
        required: variable.required,
        requiredForRun: variable.required || usageCount > 0,
        usageCount,
        ...(variable.description === undefined
          ? {}
          : { description: variable.description }),
      })),
    secrets: analysis.secretRequirements.map((requirement) => ({
      secretName: requirement.secretName,
      usageCount: requirement.usageCount,
    })),
  });
}

export function validateManifestRuntimeInputs(
  manifestInput: unknown,
  submissionInput: unknown,
): WorkflowRunInputSubmission {
  const manifest = SecureRunInputManifestSchema.safeParse(manifestInput);
  const submission =
    WorkflowRunInputSubmissionSchema.safeParse(submissionInput);
  if (!manifest.success || !submission.success) {
    throw new SecureRunInputError('RUNTIME_INPUTS_INVALID');
  }
  const definitions = new Map(
    manifest.data.variables.map(
      (variable) => [variable.name, variable] as const,
    ),
  );
  for (const variable of manifest.data.variables) {
    const value = submission.data.values[variable.name];
    if (value === undefined) {
      if (variable.requiredForRun) {
        throw new SecureRunInputError('RUNTIME_INPUTS_INVALID');
      }
      continue;
    }
    if (value.kind !== variable.valueType) {
      throw new SecureRunInputError('RUNTIME_INPUTS_INVALID');
    }
  }
  for (const name of Object.keys(submission.data.values)) {
    if (!definitions.has(name)) {
      throw new SecureRunInputError('RUNTIME_INPUTS_INVALID');
    }
  }
  return submission.data;
}
