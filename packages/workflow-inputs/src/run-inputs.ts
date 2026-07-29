import type { WorkflowVariable } from '@tasktwin/workflow-schema';

import { analyzeWorkflowInputs } from './analysis.js';
import { WORKFLOW_INPUTS_SCHEMA_VERSION } from './constants.js';
import {
  PreparedRunInputPlanSchema,
  RunInputValidationResultSchema,
  WorkflowRunInputSubmissionSchema,
  type PreparedRunInputPlan,
  type RunInputIssue,
  type RunInputValidationResult,
  type RuntimeInputValue,
  type SafeRunInputSummary,
} from './contracts.js';

export function prepareRunInputPlan(input: unknown): PreparedRunInputPlan {
  const analysis = analyzeWorkflowInputs(input);
  return PreparedRunInputPlanSchema.parse({
    schemaVersion: WORKFLOW_INPUTS_SCHEMA_VERSION,
    workflowId: analysis.workflowId,
    workflowVersion: analysis.workflowVersion,
    variables: analysis.variables.map((item) => item.variable),
    secretRequirements: analysis.secretRequirements,
    issues: analysis.issues,
    canCollectInputs: !analysis.hasBlockingIssues,
  });
}

function valueMatchesVariable(
  value: RuntimeInputValue,
  variable: WorkflowVariable,
): boolean {
  return value.kind === variable.valueType;
}

export function validateWorkflowRunInputs(
  workflowInput: unknown,
  submissionInput: unknown,
): RunInputValidationResult {
  const plan = prepareRunInputPlan(workflowInput);
  const submission =
    WorkflowRunInputSubmissionSchema.safeParse(submissionInput);
  const issues: RunInputIssue[] = [];

  if (!submission.success) {
    issues.push({
      code: 'INVALID_SUBMISSION',
      message: 'Run input submission is invalid.',
      path: [],
    });
  }

  const values = submission.success ? submission.data.values : {};
  const variableByName = new Map(
    plan.variables.map((variable) => [variable.name, variable] as const),
  );

  for (const variable of plan.variables) {
    const value = values[variable.name];
    if (value === undefined) {
      if (variable.required) {
        issues.push({
          code: 'MISSING_REQUIRED_INPUT',
          message: 'A required run input is missing.',
          variableName: variable.name,
          path: ['values', variable.name],
        });
      }
      continue;
    }

    if (!valueMatchesVariable(value, variable)) {
      issues.push({
        code: 'RUNTIME_INPUT_TYPE_MISMATCH',
        message: 'Run input type does not match the variable declaration.',
        variableName: variable.name,
        path: ['values', variable.name],
      });
    }
  }

  for (const name of Object.keys(values).sort()) {
    if (!variableByName.has(name)) {
      issues.push({
        code: 'UNKNOWN_RUNTIME_INPUT',
        message: 'Run input does not match a declared workflow variable.',
        variableName: name,
        path: ['values', name],
      });
    }
  }

  const providedValues = Object.values(values);
  const summary: SafeRunInputSummary = {
    declaredCount: plan.variables.length,
    requiredCount: plan.variables.filter((variable) => variable.required)
      .length,
    providedCount: providedValues.length,
    missingRequiredCount: issues.filter(
      (issue) => issue.code === 'MISSING_REQUIRED_INPUT',
    ).length,
    fileCount: providedValues.filter((value) => value.kind === 'file').length,
    issueCount: issues.length,
    valid: issues.length === 0,
  };

  return RunInputValidationResultSchema.parse({ issues, summary });
}
