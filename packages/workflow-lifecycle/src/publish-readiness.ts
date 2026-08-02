import { analyzeWorkflowInputs } from '@tasktwin/workflow-inputs';
import { WorkflowDefinitionSchema } from '@tasktwin/workflow-schema';
import { analyzeWorkflowVerifications } from '@tasktwin/workflow-verification';
import { analyzeWorkflowExtraction } from '@tasktwin/workflow-extraction';
import { analyzeWorkflowApprovals } from '@tasktwin/workflow-approval';

import {
  MAX_LIFECYCLE_ISSUES,
  PublishReadinessReportSchema,
  WORKFLOW_LIFECYCLE_SCHEMA_VERSION,
  type PublishReadinessIssue,
  type PublishReadinessIssueCode,
  type PublishReadinessReport,
} from './contracts.js';

const ISSUE_DETAILS = {
  UNSUPPORTED_WORKFLOW_SCHEMA_VERSION: {
    severity: 'blocking',
    message: 'The workflow schema version is not supported.',
  },
  INVALID_WORKFLOW_DEFINITION: {
    severity: 'blocking',
    message: 'The workflow definition is invalid.',
  },
  WORKFLOW_STEPS_REQUIRED: {
    severity: 'blocking',
    message: 'The workflow must contain at least one step.',
  },
  DUPLICATE_STEP_ID: {
    severity: 'blocking',
    message: 'Workflow step IDs must be unique.',
  },
  DUPLICATE_VARIABLE_NAME: {
    severity: 'blocking',
    message: 'Workflow variable names must be unique.',
  },
  UNKNOWN_VARIABLE_REFERENCE: {
    severity: 'blocking',
    message: 'A referenced workflow variable does not exist.',
  },
  INCOMPATIBLE_VARIABLE_TYPE: {
    severity: 'blocking',
    message: 'A workflow variable type is incompatible with its usage.',
  },
  INCOMPATIBLE_LITERAL: {
    severity: 'blocking',
    message: 'A literal value type is incompatible with its usage.',
  },
  SECRET_SOURCE_NOT_ALLOWED: {
    severity: 'blocking',
    message: 'A secret reference is not allowed for this property.',
  },
  UNSAFE_SECRET_REFERENCE: {
    severity: 'blocking',
    message: 'A secret reference must be a safe alias.',
  },
  UNUSED_VARIABLE: {
    severity: 'warning',
    message: 'A workflow variable is not referenced by any step.',
  },
  INVALID_VERIFICATION: {
    severity: 'blocking',
    message: 'A Verify step contains an invalid or unsafe rule.',
  },
  OUTCOME_VERIFICATION_MISSING: {
    severity: 'warning',
    message: 'The workflow has no valid explicit outcome verification.',
  },
  INVALID_EXTRACT_STEP: {
    severity: 'blocking',
    message: 'An Extract step is invalid.',
  },
  UNSUPPORTED_EXTRACTION_SOURCE: {
    severity: 'blocking',
    message: 'An extraction source is unsupported.',
  },
  DUPLICATE_OUTPUT_NAME: {
    severity: 'blocking',
    message: 'Workflow output names must be unique.',
  },
  UNKNOWN_OUTPUT_REFERENCE: {
    severity: 'blocking',
    message: 'A referenced workflow output does not exist.',
  },
  OUTPUT_REFERENCE_BEFORE_PRODUCER: {
    severity: 'blocking',
    message: 'An output must be produced before use.',
  },
  OUTPUT_SELF_REFERENCE: {
    severity: 'blocking',
    message: 'An Extract step cannot consume its own output.',
  },
  OUTPUT_TYPE_INCOMPATIBLE: {
    severity: 'blocking',
    message: 'An output type is incompatible with its consumer.',
  },
  OUTPUT_NAVIGATE_FORBIDDEN: {
    severity: 'blocking',
    message: 'Navigate cannot use an output source.',
  },
  PASSWORD_EXTRACTION_FORBIDDEN: {
    severity: 'blocking',
    message: 'Password values cannot be extracted.',
  },
  UNUSED_OUTPUT: {
    severity: 'warning',
    message: 'A workflow output is not used.',
  },
  APPROVAL_STEP_ORPHANED: {
    severity: 'blocking',
    message: 'An Approval step must gate an immediate following step.',
  },
  APPROVAL_GATED_STEP_INVALID: {
    severity: 'blocking',
    message: 'The Approval Step has an invalid gated-step binding.',
  },
} as const satisfies Record<
  PublishReadinessIssueCode,
  { severity: 'blocking' | 'warning'; message: string }
>;

function safePath(path: PropertyKey[]): Array<string | number> {
  return path.filter(
    (segment): segment is string | number =>
      typeof segment === 'string' ||
      (typeof segment === 'number' && segment >= 0),
  );
}

function structuralIssue(issue: {
  code: string;
  message: string;
  path: PropertyKey[];
}): PublishReadinessIssue {
  const path = safePath(issue.path);
  let code: PublishReadinessIssueCode = 'INVALID_WORKFLOW_DEFINITION';

  if (path[0] === 'schemaVersion') {
    code = 'UNSUPPORTED_WORKFLOW_SCHEMA_VERSION';
  } else if (
    path.length === 1 &&
    path[0] === 'steps' &&
    issue.code === 'too_small'
  ) {
    code = 'WORKFLOW_STEPS_REQUIRED';
  } else if (
    path[0] === 'steps' &&
    path.at(-1) === 'id' &&
    issue.message.startsWith('Duplicate step ID:')
  ) {
    code = 'DUPLICATE_STEP_ID';
  } else if (
    path[0] === 'variables' &&
    path.at(-1) === 'name' &&
    issue.message.startsWith('Duplicate variable name:')
  ) {
    code = 'DUPLICATE_VARIABLE_NAME';
  }

  return {
    code,
    severity: ISSUE_DETAILS[code].severity,
    message: ISSUE_DETAILS[code].message,
    path,
  };
}

function getIdentity(input: unknown): {
  workflowId: string;
  workflowVersion: number;
  stepCount: number;
  variableCount: number;
} {
  if (typeof input !== 'object' || input === null) {
    return {
      workflowId: '',
      workflowVersion: 0,
      stepCount: 0,
      variableCount: 0,
    };
  }

  const record = input as Record<string, unknown>;
  return {
    workflowId: typeof record.workflowId === 'string' ? record.workflowId : '',
    workflowVersion:
      typeof record.version === 'number' &&
      Number.isInteger(record.version) &&
      record.version >= 0
        ? record.version
        : 0,
    stepCount: Array.isArray(record.steps) ? record.steps.length : 0,
    variableCount: Array.isArray(record.variables)
      ? record.variables.length
      : 0,
  };
}

export function analyzePublishReadiness(
  input: unknown,
): PublishReadinessReport {
  const parsed = WorkflowDefinitionSchema.safeParse(input);
  const identity = getIdentity(input);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, MAX_LIFECYCLE_ISSUES)
      .map(structuralIssue);
    return PublishReadinessReportSchema.parse({
      schemaVersion: WORKFLOW_LIFECYCLE_SCHEMA_VERSION,
      workflowId: identity.workflowId,
      workflowVersion: identity.workflowVersion,
      ready: false,
      issues,
      summary: {
        blockingCount: issues.length,
        warningCount: 0,
        issueCount: issues.length,
        stepCount: identity.stepCount,
        variableCount: identity.variableCount,
        secretRequirementCount: 0,
      },
    });
  }

  const analysis = analyzeWorkflowInputs(parsed.data);
  const issues: PublishReadinessIssue[] = analysis.issues.map((issue) => {
    const code = issue.code;
    const details = ISSUE_DETAILS[code];
    return {
      code,
      severity: details.severity,
      message: details.message,
      path: issue.path,
      ...(issue.stepId === undefined ? {} : { stepId: issue.stepId }),
      ...(issue.stepIndex === undefined ? {} : { stepIndex: issue.stepIndex }),
      ...(issue.variableName === undefined
        ? {}
        : { variableName: issue.variableName }),
    };
  });
  const verification = analyzeWorkflowVerifications(parsed.data);
  issues.push(
    ...verification.issues.map((issue) => ({
      code: 'INVALID_VERIFICATION' as const,
      severity: 'blocking' as const,
      message: ISSUE_DETAILS.INVALID_VERIFICATION.message,
      path: issue.path,
      stepId: issue.stepId,
      stepIndex: issue.stepIndex,
    })),
  );
  if (!verification.hasValidVerification) {
    issues.push({
      code: 'OUTCOME_VERIFICATION_MISSING',
      severity: 'warning',
      message: ISSUE_DETAILS.OUTCOME_VERIFICATION_MISSING.message,
      path: ['steps'],
    });
  }
  const extraction = analyzeWorkflowExtraction(parsed.data);
  issues.push(
    ...extraction.issues.map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      message: ISSUE_DETAILS[issue.code].message,
      path: issue.path,
      ...(issue.stepId === undefined ? {} : { stepId: issue.stepId }),
      ...(issue.stepIndex === undefined ? {} : { stepIndex: issue.stepIndex }),
    })),
  );
  const approvals = analyzeWorkflowApprovals(parsed.data);
  issues.push(
    ...approvals.issues.map((issue) => ({
      code: issue.code,
      severity: 'blocking' as const,
      message: ISSUE_DETAILS[issue.code].message,
      path: issue.path,
      stepId: issue.stepId,
      stepIndex: issue.stepIndex,
    })),
  );
  const blockingCount = issues.filter(
    (issue) => issue.severity === 'blocking',
  ).length;
  const warningCount = issues.length - blockingCount;

  return PublishReadinessReportSchema.parse({
    schemaVersion: WORKFLOW_LIFECYCLE_SCHEMA_VERSION,
    workflowId: parsed.data.workflowId,
    workflowVersion: parsed.data.version,
    ready: blockingCount === 0,
    issues,
    summary: {
      blockingCount,
      warningCount,
      issueCount: issues.length,
      stepCount: parsed.data.steps.length,
      variableCount: parsed.data.variables.length,
      secretRequirementCount: analysis.secretRequirements.length,
    },
  });
}
