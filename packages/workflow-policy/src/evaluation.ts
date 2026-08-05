import { analyzeWorkflowApprovals } from '@tasktwin/workflow-approval';
import type {
  WorkflowActionIntent,
  WorkflowDefinition,
  WorkflowStep,
} from '@tasktwin/workflow-schema';

import { canonicalizePolicyDefinition } from './canonicalization.js';
import {
  WorkflowPolicyEvaluationInputSchema,
  WorkflowPolicyEvaluationSchema,
  type PolicyDecision,
  type PolicyEvaluationIssue,
  type PolicyIssueCode,
  type PolicyRiskLevel,
  type StepPolicyEvaluation,
  type WorkspaceExecutionPolicyDefinition,
  type WorkflowPolicyEvaluation,
} from './contracts.js';
import { originMatchesPattern, ruleMatches } from './matching.js';
import { inspectUrlOrigin } from './origin-pattern.js';
import {
  baseRiskForIntent,
  deriveActionIntent,
  riskAtLeast,
  strongerDecision,
  strongerRisk,
} from './risk.js';

function issue(
  code: PolicyIssueCode,
  severity: 'blocking' | 'warning',
  step?: WorkflowStep,
  stepIndex?: number,
  ruleId?: string,
): PolicyEvaluationIssue {
  return {
    code,
    severity,
    ...(step === undefined ? {} : { stepId: step.id }),
    ...(stepIndex === undefined ? {} : { stepIndex }),
    ...(ruleId === undefined ? {} : { ruleId }),
  };
}

function compareIssues(
  left: PolicyEvaluationIssue,
  right: PolicyEvaluationIssue,
): number {
  return (
    (left.stepIndex ?? -1) - (right.stepIndex ?? -1) ||
    left.code.localeCompare(right.code) ||
    (left.ruleId ?? '').localeCompare(right.ruleId ?? '')
  );
}

function workflowDeclaredOrigins(workflow: WorkflowDefinition): string[] {
  const origins = workflow.steps.flatMap((step) => {
    if (
      step.type !== 'navigate' ||
      step.url.kind !== 'literal' ||
      typeof step.url.value !== 'string'
    ) {
      return [];
    }
    const fact = inspectUrlOrigin(step.url.value);
    return fact.safe && fact.origin !== null ? [fact.origin] : [];
  });
  return [...new Set(origins)].sort((left, right) => left.localeCompare(right));
}

function originDecision(
  policy: WorkspaceExecutionPolicyDefinition,
  declaredOrigins: readonly string[],
  urlValue: string,
): { decision: PolicyDecision; origin: string | null; code?: PolicyIssueCode } {
  const fact = inspectUrlOrigin(urlValue);
  if (!fact.safe || fact.origin === null) {
    return {
      decision: 'deny',
      origin: null,
      code: fact.error ?? 'POLICY_ORIGIN_INVALID',
    };
  }
  const url = new URL(fact.origin);
  if (
    url.protocol === 'http:' &&
    (!fact.loopback || !policy.network.allowLoopbackHttp)
  ) {
    return {
      decision: 'deny',
      origin: fact.origin,
      code: 'POLICY_HTTP_ORIGIN_DENIED',
    };
  }
  if (
    policy.network.blockedOrigins.some((pattern) =>
      originMatchesPattern(fact.origin!, pattern),
    )
  ) {
    return {
      decision: 'deny',
      origin: fact.origin,
      code: 'POLICY_ORIGIN_BLOCKED',
    };
  }
  const allowed =
    policy.network.mode === 'workflow_declared_origins'
      ? declaredOrigins.includes(fact.origin)
      : policy.network.allowedOrigins.some((pattern) =>
          originMatchesPattern(fact.origin!, pattern),
        );
  return allowed
    ? { decision: 'allow', origin: fact.origin }
    : {
        decision: 'deny',
        origin: fact.origin,
        code: 'POLICY_ORIGIN_NOT_ALLOWED',
      };
}

function approvalRequired(
  policy: WorkspaceExecutionPolicyDefinition,
  risk: PolicyRiskLevel,
): boolean {
  return policy.approval.threshold === 'high_or_above'
    ? riskAtLeast(risk, 'high')
    : risk === 'critical';
}

function evaluateStep(
  policy: WorkspaceExecutionPolicyDefinition,
  declaredOrigins: readonly string[],
  approvalBindings: ReadonlySet<string>,
  step: WorkflowStep,
  stepIndex: number,
  currentOrigin: string | null,
): { result: StepPolicyEvaluation; nextOrigin: string | null } {
  const intent: WorkflowActionIntent = deriveActionIntent(step);
  let risk = baseRiskForIntent(intent, policy.unknownActionRisk);
  let decision: PolicyDecision = 'allow';
  const issues: PolicyEvaluationIssue[] = [];
  let origin = currentOrigin;

  if (intent === 'unknown') {
    issues.push(issue('POLICY_UNKNOWN_ACTION_INTENT', 'warning', step, stepIndex));
  }
  if (step.type === 'navigate') {
    if (step.url.kind !== 'literal' || typeof step.url.value !== 'string') {
      decision = 'deny';
      issues.push(issue('POLICY_ORIGIN_INVALID', 'blocking', step, stepIndex));
      origin = null;
    } else {
      const network = originDecision(
        policy,
        declaredOrigins,
        step.url.value,
      );
      decision = strongerDecision(decision, network.decision);
      origin = network.origin;
      if (network.code !== undefined) {
        issues.push(issue(network.code, 'blocking', step, stepIndex));
      }
    }
  }

  const matchedRules = policy.rules.filter((rule) =>
    ruleMatches(rule, { step, intent, origin }),
  );
  matchedRules.forEach((rule) => {
    if (rule.minimumRisk !== undefined) {
      risk = strongerRisk(risk, rule.minimumRisk);
    }
    if (rule.decision !== undefined) {
      decision = strongerDecision(decision, rule.decision);
    }
  });

  if (risk === 'critical') {
    decision = strongerDecision(
      decision,
      policy.approval.criticalActionBehavior === 'deny'
        ? 'deny'
        : 'require_approval',
    );
  } else if (approvalRequired(policy, risk)) {
    decision = strongerDecision(decision, 'require_approval');
  }
  if (riskAtLeast(risk, 'high')) {
    issues.push(issue('POLICY_HIGH_RISK_ACTION', 'warning', step, stepIndex));
  }

  const requiresApproval = decision === 'require_approval';
  const satisfied =
    requiresApproval && approvalBindings.has(`${stepIndex - 1}:${stepIndex}`);
  if (decision === 'deny') {
    issues.push(issue('POLICY_ACTION_DENIED', 'blocking', step, stepIndex));
  } else if (requiresApproval && !satisfied) {
    issues.push(
      issue('POLICY_APPROVAL_REQUIRED_MISSING', 'blocking', step, stepIndex),
    );
  }

  const matchedRuleIds = matchedRules
    .map((rule) => rule.id)
    .sort((left, right) => left.localeCompare(right));
  return {
    result: {
      stepId: step.id,
      stepIndex,
      stepType: step.type,
      actionIntent: intent,
      risk,
      decision,
      matchedRuleIds,
      approvalRequired: requiresApproval,
      approvalSatisfied: satisfied,
      issues: issues.sort(compareIssues),
    },
    nextOrigin: origin,
  };
}

export function evaluateWorkflowPolicy(input: unknown): WorkflowPolicyEvaluation {
  const parsed = WorkflowPolicyEvaluationInputSchema.parse(input);
  const policy = canonicalizePolicyDefinition(parsed.policy);
  const declaredOrigins = workflowDeclaredOrigins(parsed.workflow);
  const approvalAnalysis = analyzeWorkflowApprovals(parsed.workflow);
  const bindings = new Set(
    approvalAnalysis.bindings.map(
      (binding) => `${binding.approvalStepIndex}:${binding.gatedStepIndex}`,
    ),
  );
  const steps: StepPolicyEvaluation[] = [];
  let currentOrigin: string | null = null;
  parsed.workflow.steps.forEach((step, index) => {
    const evaluated = evaluateStep(
      policy,
      declaredOrigins,
      bindings,
      step,
      index,
      currentOrigin,
    );
    steps.push(evaluated.result);
    currentOrigin = evaluated.nextOrigin;
  });

  const issues = steps.flatMap((step) => step.issues);
  if (declaredOrigins.length > 1) {
    issues.push(issue('POLICY_MULTIPLE_WORKFLOW_ORIGINS', 'warning'));
  }
  approvalAnalysis.issues.forEach((approvalIssue) => {
    issues.push(
      issue(
        'POLICY_APPROVAL_BINDING_INVALID',
        'blocking',
        parsed.workflow.steps[approvalIssue.stepIndex],
        approvalIssue.stepIndex,
      ),
    );
  });
  issues.sort(compareIssues);

  const overallDecision = steps.reduce<PolicyDecision>(
    (result, step) => strongerDecision(result, step.decision),
    'allow',
  );
  const highestRisk = steps.reduce<PolicyRiskLevel>(
    (result, step) => strongerRisk(result, step.risk),
    'low',
  );
  return WorkflowPolicyEvaluationSchema.parse({
    schemaVersion: 1,
    policyDigest: parsed.policyDigest,
    workflowDigest: parsed.workflowDigest,
    overallDecision,
    highestRisk,
    steps,
    matchedRuleIds: [
      ...new Set(steps.flatMap((step) => step.matchedRuleIds)),
    ].sort((left, right) => left.localeCompare(right)),
    issues,
    hasBlockingIssues: issues.some((item) => item.severity === 'blocking'),
  });
}

export function evaluateRuntimeOrigin(
  policyInput: unknown,
  workflowInput: unknown,
  urlValue: string,
): { allowed: boolean; issueCode?: PolicyIssueCode; origin?: string } {
  const policy = canonicalizePolicyDefinition(policyInput);
  const workflow = WorkflowPolicyEvaluationInputSchema.shape.workflow.parse(
    workflowInput,
  );
  const result = originDecision(
    policy,
    workflowDeclaredOrigins(workflow),
    urlValue,
  );
  return result.decision === 'allow'
    ? { allowed: true, ...(result.origin === null ? {} : { origin: result.origin }) }
    : {
        allowed: false,
        ...(result.code === undefined ? {} : { issueCode: result.code }),
      };
}
