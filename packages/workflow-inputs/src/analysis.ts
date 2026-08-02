import {
  WorkflowDefinitionSchema,
  type WorkflowDefinition,
  type WorkflowVariable,
} from '@tasktwin/workflow-schema';

import {
  getValueSourceCompatibility,
  isLiteralCompatible,
  isVariableTypeCompatible,
} from './compatibility.js';
import { WORKFLOW_INPUTS_SCHEMA_VERSION } from './constants.js';
import {
  WorkflowInputAnalysisSchema,
  type VariableUsage,
  type WorkflowInputAnalysis,
  type WorkflowInputIssue,
  type WorkflowSecretRequirement,
} from './contracts.js';
import { isSafeSecretAlias } from './secret-alias.js';
import { findWorkflowValueSources } from './value-source-usages.js';

function invalidDefinitionAnalysis(input: unknown): WorkflowInputAnalysis {
  const workflow =
    typeof input === 'object' && input !== null
      ? (input as Record<string, unknown>)
      : {};
  const workflowId =
    typeof workflow.workflowId === 'string' ? workflow.workflowId : '';
  const workflowVersion =
    typeof workflow.version === 'number' &&
    Number.isInteger(workflow.version) &&
    workflow.version >= 0
      ? workflow.version
      : 0;
  const result = WorkflowDefinitionSchema.safeParse(input);
  const issues: WorkflowInputIssue[] = result.success
    ? []
    : result.error.issues.map((issue) => {
        const duplicateVariable =
          issue.path[0] === 'variables' &&
          issue.path[2] === 'name' &&
          issue.message.startsWith('Duplicate variable name:');
        const unsafeSecretReference =
          issue.path[0] === 'steps' &&
          issue.path[issue.path.length - 1] === 'secretName';
        return {
          code: duplicateVariable
            ? 'DUPLICATE_VARIABLE_NAME'
            : unsafeSecretReference
              ? 'UNSAFE_SECRET_REFERENCE'
              : 'INVALID_WORKFLOW_DEFINITION',
          severity: 'blocking',
          message: duplicateVariable
            ? 'Variable names must be unique.'
            : unsafeSecretReference
              ? 'Secret reference must be a safe alias.'
              : 'Workflow definition is invalid.',
          path: issue.path.filter(
            (segment): segment is string | number =>
              typeof segment === 'string' || typeof segment === 'number',
          ),
        };
      });

  return WorkflowInputAnalysisSchema.parse({
    schemaVersion: WORKFLOW_INPUTS_SCHEMA_VERSION,
    workflowId,
    workflowVersion,
    variables: [],
    secretRequirements: [],
    issues,
    hasBlockingIssues: issues.length > 0,
  });
}

function issueForUsage(
  code:
    | 'UNKNOWN_VARIABLE_REFERENCE'
    | 'INCOMPATIBLE_VARIABLE_TYPE'
    | 'INCOMPATIBLE_LITERAL'
    | 'SECRET_SOURCE_NOT_ALLOWED'
    | 'UNSAFE_SECRET_REFERENCE',
  usage: VariableUsage,
  variableName?: string,
): WorkflowInputIssue {
  const messages = {
    UNKNOWN_VARIABLE_REFERENCE: 'Referenced workflow variable does not exist.',
    INCOMPATIBLE_VARIABLE_TYPE:
      'Workflow variable type is incompatible with this step property.',
    INCOMPATIBLE_LITERAL:
      'Literal value type is incompatible with this step property.',
    SECRET_SOURCE_NOT_ALLOWED:
      'Secret references are not allowed for this step property.',
    UNSAFE_SECRET_REFERENCE: 'Secret reference must be a safe alias.',
  } as const;

  return {
    code,
    severity: 'blocking',
    message: messages[code],
    path: usage.path,
    stepId: usage.stepId,
    stepIndex: usage.stepIndex,
    ...(variableName === undefined ? {} : { variableName }),
  };
}

function createVariableAnalysis(
  variable: WorkflowVariable,
  usages: VariableUsage[],
) {
  return {
    variable,
    usageCount: usages.length,
    usages,
  };
}

export function analyzeWorkflowInputs(input: unknown): WorkflowInputAnalysis {
  const parsed = WorkflowDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return invalidDefinitionAnalysis(input);
  }

  const workflow: WorkflowDefinition = parsed.data;
  const variableByName = new Map(
    workflow.variables.map((variable) => [variable.name, variable] as const),
  );
  const usagesByVariable = new Map<string, VariableUsage[]>(
    workflow.variables.map((variable) => [variable.name, []]),
  );
  const secretByName = new Map<string, WorkflowSecretRequirement>();
  const issues: WorkflowInputIssue[] = [];

  for (const located of findWorkflowValueSources(workflow)) {
    const { source, usage } = located;
    if (source.kind === 'variable') {
      const variable = variableByName.get(source.variableName);
      if (variable === undefined) {
        issues.push(
          issueForUsage(
            'UNKNOWN_VARIABLE_REFERENCE',
            usage,
            source.variableName,
          ),
        );
        continue;
      }

      usagesByVariable.get(variable.name)?.push(usage);
      if (!isVariableTypeCompatible(usage.target, variable.valueType)) {
        issues.push(
          issueForUsage('INCOMPATIBLE_VARIABLE_TYPE', usage, variable.name),
        );
      }
      continue;
    }

    if (source.kind === 'literal') {
      if (!isLiteralCompatible(usage.target, source.value)) {
        issues.push(issueForUsage('INCOMPATIBLE_LITERAL', usage));
      }
      continue;
    }

    // Runtime outputs are validated by the framework-independent extraction
    // data-flow analyzer. They are not workflow inputs or secret requirements.
    if (source.kind === 'output') {
      continue;
    }

    if (!isSafeSecretAlias(source.secretName)) {
      issues.push(issueForUsage('UNSAFE_SECRET_REFERENCE', usage));
      continue;
    }

    if (!getValueSourceCompatibility(usage.target).allowsSecret) {
      issues.push(issueForUsage('SECRET_SOURCE_NOT_ALLOWED', usage));
      continue;
    }

    const existing = secretByName.get(source.secretName);
    if (existing === undefined) {
      secretByName.set(source.secretName, {
        secretName: source.secretName,
        usageCount: 1,
        usages: [usage],
      });
    } else {
      existing.usageCount += 1;
      existing.usages.push(usage);
    }
  }

  const variables = workflow.variables.map((variable) => {
    const usages = usagesByVariable.get(variable.name) ?? [];
    if (usages.length === 0) {
      issues.push({
        code: 'UNUSED_VARIABLE',
        severity: 'warning',
        message: 'Workflow variable is not referenced by any step.',
        path: ['variables', workflow.variables.indexOf(variable)],
        variableName: variable.name,
      });
    }
    return createVariableAnalysis(variable, usages);
  });

  return WorkflowInputAnalysisSchema.parse({
    schemaVersion: WORKFLOW_INPUTS_SCHEMA_VERSION,
    workflowId: workflow.workflowId,
    workflowVersion: workflow.version,
    variables,
    secretRequirements: [...secretByName.values()],
    issues,
    hasBlockingIssues: issues.some((issue) => issue.severity === 'blocking'),
  });
}
