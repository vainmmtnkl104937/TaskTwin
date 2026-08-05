import {
  WorkflowActionIntentSchema,
  WorkflowDefinitionSchema,
} from '@tasktwin/workflow-schema';
import { z } from 'zod';

import {
  MAX_POLICY_ISSUES,
  MAX_POLICY_ORIGIN_PATTERNS,
  MAX_POLICY_RULES,
  WORKFLOW_POLICY_SCHEMA_VERSION,
} from './constants.js';
import {
  normalizeCanonicalOrigin,
  normalizeHttpsDomain,
} from './origin-pattern.js';

export const Sha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const PolicyRiskLevelSchema = z.enum([
  'low',
  'medium',
  'high',
  'critical',
]);
export const PolicyDecisionSchema = z.enum([
  'allow',
  'require_approval',
  'deny',
]);

export const ExactOriginPatternSchema = z.strictObject({
  kind: z.literal('exact'),
  origin: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .superRefine((value, context) => {
      try {
        normalizeCanonicalOrigin(value);
      } catch {
        context.addIssue({
          code: 'custom',
          message: 'Exact origin pattern is invalid.',
        });
      }
    }),
});

export const HttpsSubdomainOriginPatternSchema = z.strictObject({
  kind: z.literal('https_subdomains'),
  patternVersion: z.literal(1),
  domain: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .superRefine((value, context) => {
      try {
        normalizeHttpsDomain(value);
      } catch {
        context.addIssue({
          code: 'custom',
          message: 'HTTPS subdomain pattern is invalid.',
        });
      }
    }),
  includeApex: z.boolean().default(false),
});

export const OriginPatternSchema = z.discriminatedUnion('kind', [
  ExactOriginPatternSchema,
  HttpsSubdomainOriginPatternSchema,
]);

const WorkflowStepTypeSchema = z.enum([
  'navigate',
  'click',
  'fill',
  'select',
  'setChecked',
  'wait',
  'extract',
  'verify',
  'approval',
]);

export const ActionPolicyRuleSchema = z
  .strictObject({
    id: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
    match: z.strictObject({
      stepTypes: z.array(WorkflowStepTypeSchema).min(1).max(9).optional(),
      actionIntents: z
        .array(WorkflowActionIntentSchema)
        .min(1)
        .max(11)
        .optional(),
      origins: z
        .array(OriginPatternSchema)
        .min(1)
        .max(MAX_POLICY_ORIGIN_PATTERNS)
        .optional(),
    }),
    minimumRisk: PolicyRiskLevelSchema.optional(),
    decision: PolicyDecisionSchema.optional(),
  })
  .superRefine((rule, context) => {
    if (rule.minimumRisk === undefined && rule.decision === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'A policy rule must define a risk or decision effect.',
      });
    }
    if (
      rule.match.stepTypes === undefined &&
      rule.match.actionIntents === undefined &&
      rule.match.origins === undefined
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A policy rule must define at least one match field.',
      });
    }
  });

export const WorkspaceExecutionPolicyDefinitionSchema = z
  .strictObject({
    schemaVersion: z.literal(WORKFLOW_POLICY_SCHEMA_VERSION),
    network: z.strictObject({
      mode: z.enum([
        'workflow_declared_origins',
        'explicit_allowlist',
      ]),
      allowedOrigins: z
        .array(OriginPatternSchema)
        .max(MAX_POLICY_ORIGIN_PATTERNS),
      blockedOrigins: z
        .array(OriginPatternSchema)
        .max(MAX_POLICY_ORIGIN_PATTERNS),
      allowLoopbackHttp: z.boolean(),
    }),
    unknownActionRisk: PolicyRiskLevelSchema,
    approval: z.strictObject({
      threshold: z.enum(['high_or_above', 'critical_only']),
      criticalActionBehavior: z.enum(['deny', 'require_approval']),
    }),
    rules: z.array(ActionPolicyRuleSchema).max(MAX_POLICY_RULES),
  })
  .superRefine((policy, context) => {
    const ruleIds = new Set<string>();
    policy.rules.forEach((rule, index) => {
      if (ruleIds.has(rule.id)) {
        context.addIssue({
          code: 'custom',
          path: ['rules', index, 'id'],
          message: 'Policy rule IDs must be unique.',
        });
      }
      ruleIds.add(rule.id);
    });
  });

export const PolicyIssueCodeSchema = z.enum([
  'POLICY_UNKNOWN_ACTION_INTENT',
  'POLICY_HIGH_RISK_ACTION',
  'POLICY_MULTIPLE_WORKFLOW_ORIGINS',
  'POLICY_UNSAFE_URL_SCHEME',
  'POLICY_URL_CREDENTIALS_DENIED',
  'POLICY_ORIGIN_INVALID',
  'POLICY_HTTP_ORIGIN_DENIED',
  'POLICY_ORIGIN_BLOCKED',
  'POLICY_ORIGIN_NOT_ALLOWED',
  'POLICY_ACTION_DENIED',
  'POLICY_APPROVAL_REQUIRED_MISSING',
  'POLICY_APPROVAL_BINDING_INVALID',
]);

export const PolicyEvaluationIssueSchema = z.strictObject({
  code: PolicyIssueCodeSchema,
  severity: z.enum(['blocking', 'warning']),
  stepId: z.string().trim().min(1).max(256).optional(),
  stepIndex: z.number().int().nonnegative().optional(),
  ruleId: z.string().trim().min(1).max(64).optional(),
});

export const StepPolicyEvaluationSchema = z.strictObject({
  stepId: z.string().trim().min(1).max(256),
  stepIndex: z.number().int().nonnegative(),
  stepType: WorkflowStepTypeSchema,
  actionIntent: WorkflowActionIntentSchema,
  risk: PolicyRiskLevelSchema,
  decision: PolicyDecisionSchema,
  matchedRuleIds: z.array(z.string().trim().min(1).max(64)).max(MAX_POLICY_RULES),
  approvalRequired: z.boolean(),
  approvalSatisfied: z.boolean(),
  issues: z.array(PolicyEvaluationIssueSchema).max(MAX_POLICY_ISSUES),
});

export const WorkflowPolicyEvaluationSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_POLICY_SCHEMA_VERSION),
  policyDigest: Sha256DigestSchema,
  workflowDigest: Sha256DigestSchema,
  overallDecision: PolicyDecisionSchema,
  highestRisk: PolicyRiskLevelSchema,
  steps: z.array(StepPolicyEvaluationSchema).max(MAX_POLICY_ISSUES),
  matchedRuleIds: z.array(z.string().trim().min(1).max(64)).max(MAX_POLICY_RULES),
  issues: z.array(PolicyEvaluationIssueSchema).max(MAX_POLICY_ISSUES),
  hasBlockingIssues: z.boolean(),
});

export const WorkflowPolicyEvaluationInputSchema = z.strictObject({
  policy: WorkspaceExecutionPolicyDefinitionSchema,
  workflow: WorkflowDefinitionSchema,
  policyDigest: Sha256DigestSchema,
  workflowDigest: Sha256DigestSchema,
});

export type PolicyRiskLevel = z.infer<typeof PolicyRiskLevelSchema>;
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
export type OriginPattern = z.infer<typeof OriginPatternSchema>;
export type ActionPolicyRule = z.infer<typeof ActionPolicyRuleSchema>;
export type WorkspaceExecutionPolicyDefinition = z.infer<
  typeof WorkspaceExecutionPolicyDefinitionSchema
>;
export type PolicyIssueCode = z.infer<typeof PolicyIssueCodeSchema>;
export type PolicyEvaluationIssue = z.infer<
  typeof PolicyEvaluationIssueSchema
>;
export type StepPolicyEvaluation = z.infer<
  typeof StepPolicyEvaluationSchema
>;
export type WorkflowPolicyEvaluation = z.infer<
  typeof WorkflowPolicyEvaluationSchema
>;
