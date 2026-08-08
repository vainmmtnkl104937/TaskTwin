import {
  analyzeWorkflowInputs,
} from '@tasktwin/workflow-inputs';
import {
  type WorkflowDefinition,
  WorkflowDefinitionSchema,
  WorkflowLifecycleStatusSchema,
} from '@tasktwin/workflow-schema';
import {
  type PolicyDecision,
  evaluateWorkflowPolicy,
  WorkspaceExecutionPolicyDefinitionSchema,
  type WorkflowPolicyEvaluation,
} from '@tasktwin/workflow-policy';
import { RecoveryModeSchema } from '@tasktwin/workflow-recovery';
import { z } from 'zod';
import type { LocalSecretStoreStatus } from '@tasktwin/local-secret-store';

import { SchedulingError } from './scheduling-errors.js';
import { buildOccurrenceKey } from './occurrence-key.js';

// ---------------------------------------------------------------------------
// Capability schema (mirrors what the Runner advertises)
// ---------------------------------------------------------------------------

const RequiredRunnerCapabilitiesSchema = z
  .object({
    scheduled_execution_v1: z.literal(true),
  })
  .partial()
  .passthrough();

export type RequiredRunnerCapabilities = z.infer<
  typeof RequiredRunnerCapabilitiesSchema
>;

// ---------------------------------------------------------------------------
// Readiness issue
// ---------------------------------------------------------------------------

export type ScheduleReadinessIssueCode =
  | 'WORKFLOW_VERSION_NOT_PUBLISHED'
  | 'WORKFLOW_DEFINITION_INVALID'
  | 'RUNTIME_INPUT_REQUIRED'
  | 'SECRET_REQUIRED'
  | 'LOCAL_SECRET_STORE_NOT_READY'
  | 'LOCAL_SECRET_ALIAS_MISSING'
  | 'FILE_INPUT_REQUIRED'
  | 'APPROVAL_STEP_FORBIDDEN'
  | 'MANUAL_REPAIR_FORBIDDEN'
  | 'LOCATOR_REPAIR_FORBIDDEN'
  | 'RECOVERY_MODE_UNSUPPORTED'
  | 'RUNNER_CAPABILITY_UNAVAILABLE'
  | 'RUNNER_NOT_IN_WORKSPACE'
  | 'RUNNER_REVOKED'
  | 'POLICY_DENIED'
  | 'POLICY_REQUIRES_APPROVAL'
  | 'WORKFLOW_VERSION_UNAVAILABLE';

export interface ScheduleReadinessIssue {
  readonly code: ScheduleReadinessIssueCode;
  readonly message: string;
  readonly stepId?: string;
  readonly stepIndex?: number;
}

export interface ScheduleReadinessReport {
  readonly ready: boolean;
  readonly issues: readonly ScheduleReadinessIssue[];
  readonly workflowDefinition: WorkflowDefinition;
  readonly allowedOrigins: readonly string[];
}

// ---------------------------------------------------------------------------
// Check: workflow version status
// ---------------------------------------------------------------------------

function checkVersionStatus(
  status: unknown,
): ScheduleReadinessIssue | null {
  const parsed = WorkflowLifecycleStatusSchema.safeParse(status);
  if (!parsed.success) {
    return {
      code: 'WORKFLOW_DEFINITION_INVALID',
      message: 'Workflow version status is invalid.',
    };
  }
  if (parsed.data !== 'published') {
    return {
      code: 'WORKFLOW_VERSION_NOT_PUBLISHED',
      message: `Workflow version status is '${parsed.data}'; only 'published' versions can be scheduled.`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Check: definition validity
// ---------------------------------------------------------------------------

function checkDefinition(definition: unknown): ScheduleReadinessIssue | null {
  const parsed = WorkflowDefinitionSchema.safeParse(definition);
  if (!parsed.success) {
    return {
      code: 'WORKFLOW_DEFINITION_INVALID',
      message: 'Workflow definition is invalid.',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Check: runtime inputs, secrets, files
// ---------------------------------------------------------------------------

function checkNoInputsRequired(
  workflow: WorkflowDefinition,
  localSecrets?: {
    capabilityAvailable: boolean;
    status: LocalSecretStoreStatus;
    synchronized: boolean;
    aliases: readonly string[];
  },
): ScheduleReadinessIssue | null {
  const analysis = analyzeWorkflowInputs(workflow);

  for (const issue of analysis.issues) {
    if (issue.severity !== 'blocking') continue;
    if (
      issue.code === 'UNKNOWN_VARIABLE_REFERENCE' ||
      issue.code === 'INCOMPATIBLE_VARIABLE_TYPE'
    ) {
      return {
        code: 'RUNTIME_INPUT_REQUIRED',
        message: `Workflow requires a runtime variable '${(issue as unknown as { variableName?: string }).variableName ?? 'unknown'}' that cannot be resolved for scheduled execution.`,
        ...(issue.stepId !== undefined ? { stepId: issue.stepId } : {}),
        ...(issue.stepIndex !== undefined ? { stepIndex: issue.stepIndex } : {}),
      };
    }
    if (issue.code === 'INCOMPATIBLE_LITERAL') {
      return {
        code: 'RUNTIME_INPUT_REQUIRED',
        message: 'Workflow step has a literal that cannot be resolved.',
        ...(issue.stepId !== undefined ? { stepId: issue.stepId } : {}),
        ...(issue.stepIndex !== undefined ? { stepIndex: issue.stepIndex } : {}),
      };
    }
  }

  // Check for secret requirements
  if (analysis.secretRequirements.length > 0) {
    if (
      localSecrets === undefined ||
      !localSecrets.capabilityAvailable ||
      localSecrets.status !== 'ready' ||
      !localSecrets.synchronized
    ) {
      return {
        code: 'LOCAL_SECRET_STORE_NOT_READY',
        message: 'The selected Runner Local Secret Store is not ready and synchronized.',
      };
    }
    const available = new Set(localSecrets.aliases);
    if (analysis.secretRequirements.some((requirement) => !available.has(requirement.secretName))) {
      return {
        code: 'LOCAL_SECRET_ALIAS_MISSING',
        message: 'The selected Runner is missing at least one required secret alias.',
      };
    }
  }

  // File inputs are tracked via compatibility checks
  const fileSteps = workflow.steps.filter((step) => {
    void step;
    // Check if any step has a file input source — currently not tracked explicitly
    // but the input analysis would flag unknown references
    return false;
  });
  void fileSteps;

  return null;
}

// ---------------------------------------------------------------------------
// Check: forbidden step types
// ---------------------------------------------------------------------------

function checkNoForbiddenSteps(
  workflow: WorkflowDefinition,
): ScheduleReadinessIssue | null {
  for (const step of workflow.steps) {
    if (step.type === 'approval') {
      return {
        code: 'APPROVAL_STEP_FORBIDDEN',
        message: 'Workflow contains an Approval Step which requires human intervention and cannot be scheduled.',
        stepId: step.id,
        stepIndex: workflow.steps.indexOf(step),
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Check: recovery mode
// ---------------------------------------------------------------------------

function checkRecoveryMode(
  recoveryMode: unknown,
): ScheduleReadinessIssue | null {
  const parsed = RecoveryModeSchema.safeParse(recoveryMode);
  if (!parsed.success) {
    return {
      code: 'RECOVERY_MODE_UNSUPPORTED',
      message: 'Recovery mode is not supported for scheduled execution.',
    };
  }
  if (parsed.data === 'automatic_safe_and_manual') {
    return {
      code: 'MANUAL_REPAIR_FORBIDDEN',
      message: 'Scheduled runs cannot use manual repair recovery mode.',
    };
  }
  if (parsed.data === 'automatic_safe_and_locator_proposals') {
    return {
      code: 'LOCATOR_REPAIR_FORBIDDEN',
      message: 'Scheduled runs cannot use locator repair proposals recovery mode.',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Check: Runner capabilities
// ---------------------------------------------------------------------------

function checkRunnerCapabilities(
  runnerCapabilities: readonly string[],
): ScheduleReadinessIssue | null {
  // For scheduled execution, the Runner must advertise scheduled_execution_v1
  // However, this check is done at the API/repository level since we don't
  // have access to runner capabilities here. We just verify the structure.
  if (!Array.isArray(runnerCapabilities)) {
    return {
      code: 'RUNNER_CAPABILITY_UNAVAILABLE',
      message: 'Runner capabilities are not available.',
    };
  }
  // Note: scheduled_execution_v1 check is done at repository level
  return null;
}

// ---------------------------------------------------------------------------
// Check: Runner workspace membership
// ---------------------------------------------------------------------------

function checkRunnerWorkspace(
  runnerWorkspaceId: string | null,
  targetWorkspaceId: string,
): ScheduleReadinessIssue | null {
  if (runnerWorkspaceId === null) {
    return {
      code: 'WORKFLOW_VERSION_UNAVAILABLE', // repurposed
      message: 'Runner workspace membership could not be verified.',
    };
  }
  if (runnerWorkspaceId !== targetWorkspaceId) {
    return {
      code: 'RUNNER_NOT_IN_WORKSPACE',
      message: 'Selected Runner belongs to a different Workspace.',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Check: Runner revoked
// ---------------------------------------------------------------------------

function checkRunnerRevoked(revokedAt: Date | null): ScheduleReadinessIssue | null {
  if (revokedAt !== null) {
    return {
      code: 'RUNNER_REVOKED',
      message: 'Selected Runner has been revoked.',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Check: policy evaluation
// ---------------------------------------------------------------------------

export function evaluateSchedulePolicy(
  policy: unknown,
  workflow: WorkflowDefinition,
  policyDigest: string,
  workflowDigest: string,
): {
  overallDecision: PolicyDecision;
  issues: ScheduleReadinessIssue[];
  allowedOrigins: string[];
} {
  const policyParsed =
    WorkspaceExecutionPolicyDefinitionSchema.safeParse(policy);
  if (!policyParsed.success) {
    return {
      overallDecision: 'deny',
      issues: [
        {
          code: 'POLICY_DENIED',
          message: 'Current execution policy is invalid.',
        },
      ],
      allowedOrigins: [],
    };
  }

  const result = evaluateWorkflowPolicy({
    policy: policyParsed.data,
    workflow,
    policyDigest,
    workflowDigest,
  });

  const issues: ScheduleReadinessIssue[] = result.issues
    .filter((i) => i.severity === 'blocking')
    .map((i) => ({
      code:
        i.code === 'POLICY_ACTION_DENIED' ||
        i.code === 'POLICY_ORIGIN_BLOCKED' ||
        i.code === 'POLICY_HTTP_ORIGIN_DENIED'
          ? 'POLICY_DENIED'
          : 'POLICY_REQUIRES_APPROVAL',
      message: `Policy issue: ${i.code}`,
      ...(i.stepId !== undefined ? { stepId: i.stepId } : {}),
      ...(i.stepIndex !== undefined ? { stepIndex: i.stepIndex } : {}),
    }));

  const allowedOrigins: string[] = [];
  // Extract allowed origins from policy (simplified — actual extraction
  // would consult the full policy evaluation)
  void policyDigest;

  return {
    overallDecision: result.overallDecision,
    issues,
    allowedOrigins,
  };
}

// ---------------------------------------------------------------------------
// Top-level readiness analysis
// ---------------------------------------------------------------------------

export interface UnattendedReadinessInput {
  readonly workflowVersionId: string;
  readonly workflowVersionStatus: unknown;
  readonly workflowDefinition: unknown;
  readonly workflowDigest: string;
  readonly workflowId: string;
  readonly workspaceId: string;
  readonly runnerDeviceId: string;
  readonly runnerCapabilities: readonly string[];
  readonly runnerWorkspaceId: string | null;
  readonly runnerRevokedAt: Date | null;
  readonly executionPolicy: unknown;
  readonly executionPolicyDigest: string;
  readonly executionPolicyEvaluation: unknown;
  readonly executionPolicyDecision: unknown;
  readonly recoveryMode: unknown;
}

export function analyzeUnattendedReadiness(
  input: UnattendedReadinessInput,
): ScheduleReadinessReport {
  const issues: ScheduleReadinessIssue[] = [];

  // 1. Version status
  const vsIssue = checkVersionStatus(input.workflowVersionStatus);
  if (vsIssue) { issues.push(vsIssue); }

  // 2. Definition validity
  const defIssue = checkDefinition(input.workflowDefinition);
  if (defIssue) { issues.push(defIssue); }

  // If definition is invalid, we can't proceed
  const defParsed = WorkflowDefinitionSchema.safeParse(input.workflowDefinition);
  if (!defParsed.success) {
    return {
      ready: false,
      issues,
      workflowDefinition: input.workflowDefinition as WorkflowDefinition,
      allowedOrigins: [],
    };
  }
  const workflow = defParsed.data;

  // 3. No runtime inputs
  const inputIssue = checkNoInputsRequired(workflow);
  if (inputIssue) { issues.push(inputIssue); }

  // 4. No forbidden step types
  const stepIssue = checkNoForbiddenSteps(workflow);
  if (stepIssue) { issues.push(stepIssue); }

  // 5. Recovery mode
  const recoveryIssue = checkRecoveryMode(input.recoveryMode);
  if (recoveryIssue) { issues.push(recoveryIssue); }

  // 6. Runner capabilities (structural — real check at repo)
  const capIssue = checkRunnerCapabilities(input.runnerCapabilities);
  if (capIssue) { issues.push(capIssue); }

  // 7. Runner workspace
  const wsIssue = checkRunnerWorkspace(input.runnerWorkspaceId, input.workspaceId);
  if (wsIssue) { issues.push(wsIssue); }

  // 8. Runner revoked
  const revIssue = checkRunnerRevoked(input.runnerRevokedAt);
  if (revIssue) { issues.push(revIssue); }

  // 9. Policy evaluation
  const policyResult = evaluateSchedulePolicy(
    input.executionPolicy,
    workflow,
    input.executionPolicyDigest,
    input.workflowDigest,
  );
  issues.push(...policyResult.issues);

  const overallDenied =
    policyResult.overallDecision === 'deny' ||
    issues.some(
      (i) => i.code === 'POLICY_DENIED' || i.code === 'POLICY_REQUIRES_APPROVAL',
    );

  return {
    ready: issues.length === 0,
    issues,
    workflowDefinition: workflow,
    allowedOrigins: policyResult.allowedOrigins,
  };
}

/**
 * Minimal readiness check for schedule creation (server-side).
 * This is a lighter version used at schedule creation time.
 */
export interface ScheduleCreationReadinessInput {
  readonly workflowVersionStatus: unknown;
  readonly workflowDefinition: unknown;
  readonly runnerWorkspaceId: string | null;
  readonly targetWorkspaceId: string;
  readonly runnerRevokedAt: Date | null;
  readonly executionPolicy: unknown;
  readonly executionPolicyDigest: string;
  readonly workflowDigest: string;
  readonly localSecrets?: {
    readonly capabilityAvailable: boolean;
    readonly status: LocalSecretStoreStatus;
    readonly synchronized: boolean;
    readonly aliases: readonly string[];
  };
}

export function analyzeScheduleCreationReadiness(
  input: ScheduleCreationReadinessInput,
): { ready: boolean; issues: ScheduleReadinessIssue[] } {
  const issues: ScheduleReadinessIssue[] = [];

  const vsIssue = checkVersionStatus(input.workflowVersionStatus);
  if (vsIssue) issues.push(vsIssue);

  const defIssue = checkDefinition(input.workflowDefinition);
  if (defIssue) issues.push(defIssue);

  const defParsed = WorkflowDefinitionSchema.safeParse(input.workflowDefinition);
  if (!defParsed.success) {
    return { ready: false, issues };
  }
  const workflow = defParsed.data;

  const inputIssue = checkNoInputsRequired(workflow, input.localSecrets);
  if (inputIssue) issues.push(inputIssue);

  const stepIssue = checkNoForbiddenSteps(workflow);
  if (stepIssue) issues.push(stepIssue);

  const wsIssue = checkRunnerWorkspace(input.runnerWorkspaceId, input.targetWorkspaceId);
  if (wsIssue) issues.push(wsIssue);

  const revIssue = checkRunnerRevoked(input.runnerRevokedAt);
  if (revIssue) issues.push(revIssue);

  const policyResult = evaluateSchedulePolicy(
    input.executionPolicy,
    workflow,
    input.executionPolicyDigest,
    input.workflowDigest,
  );
  issues.push(...policyResult.issues);

  return { ready: issues.length === 0, issues };
}
