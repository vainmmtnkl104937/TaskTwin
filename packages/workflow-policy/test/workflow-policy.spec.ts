import { createHash } from 'node:crypto';

import type { WorkflowDefinition } from '@tasktwin/workflow-schema';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WORKSPACE_EXECUTION_POLICY,
  baseRiskForIntent,
  canonicalPolicyJson,
  evaluateRuntimeOrigin,
  evaluateWorkflowPolicy,
  strongerDecision,
  type ActionPolicyRule,
  type WorkspaceExecutionPolicyDefinition,
} from '../src/index.js';

const DIGEST = 'a'.repeat(64);

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function workflow(steps: WorkflowDefinition['steps']): WorkflowDefinition {
  return {
    schemaVersion: 1,
    workflowId: 'workflow-policy-test',
    version: 1,
    name: 'Policy test',
    status: 'published',
    variables: [],
    steps,
  };
}

function evaluate(
  steps: WorkflowDefinition['steps'],
  policy: WorkspaceExecutionPolicyDefinition = DEFAULT_WORKSPACE_EXECUTION_POLICY,
) {
  return evaluateWorkflowPolicy({
    policy,
    workflow: workflow(steps),
    policyDigest: DIGEST,
    workflowDigest: DIGEST,
  });
}

describe('workflow policy', () => {
  it('uses deterministic decision and base-risk strength', () => {
    expect(strongerDecision('allow', 'require_approval')).toBe(
      'require_approval',
    );
    expect(strongerDecision('require_approval', 'deny')).toBe('deny');
    expect(baseRiskForIntent('read', 'medium')).toBe('low');
    expect(baseRiskForIntent('enter_data', 'low')).toBe('medium');
    expect(baseRiskForIntent('submit', 'low')).toBe('high');
    expect(baseRiskForIntent('delete', 'low')).toBe('critical');
  });

  it('treats a legacy click as explicit unknown and never low risk', () => {
    const result = evaluate([
      {
        id: 'click-1',
        type: 'click',
        name: 'Legacy click',
        locator: { kind: 'testId', value: 'legacy' },
      },
    ]);
    expect(result.steps[0]).toMatchObject({
      actionIntent: 'unknown',
      risk: 'medium',
    });
    expect(result.issues.map((item) => item.code)).toContain(
      'POLICY_UNKNOWN_ACTION_INTENT',
    );
  });

  it('aggregates overlapping rules independently from JSON ordering', () => {
    const rules: ActionPolicyRule[] = [
      {
        id: 'raise-risk',
        match: { actionIntents: ['submit'] },
        minimumRisk: 'critical' as const,
      },
      {
        id: 'deny-submit',
        match: { stepTypes: ['click'] },
        decision: 'deny' as const,
      },
    ];
    const base = {
      ...DEFAULT_WORKSPACE_EXECUTION_POLICY,
      approval: {
        threshold: 'high_or_above' as const,
        criticalActionBehavior: 'require_approval' as const,
      },
    };
    const step = {
      id: 'submit',
      type: 'click' as const,
      name: 'Submit',
      locator: { kind: 'testId' as const, value: 'submit' },
      actionIntent: 'submit' as const,
    };
    const first = evaluate([step], { ...base, rules: [...rules] });
    const second = evaluate([step], { ...base, rules: [...rules].reverse() });
    expect(first.steps[0]).toEqual(second.steps[0]);
    expect(first.steps[0]).toMatchObject({ risk: 'critical', decision: 'deny' });
    expect(first.steps[0]?.matchedRuleIds).toEqual([
      'deny-submit',
      'raise-risk',
    ]);
  });

  it('makes blocked origin win over explicit allowlist', () => {
    const policy: WorkspaceExecutionPolicyDefinition = {
      ...DEFAULT_WORKSPACE_EXECUTION_POLICY,
      network: {
        mode: 'explicit_allowlist',
        allowLoopbackHttp: false,
        allowedOrigins: [
          { kind: 'https_subdomains', patternVersion: 1, domain: 'example.com', includeApex: true },
        ],
        blockedOrigins: [
          { kind: 'exact', origin: 'https://blocked.example.com' },
        ],
      },
    };
    expect(
      evaluateRuntimeOrigin(
        policy,
        workflow([
          { id: 'nav', type: 'navigate', name: 'Navigate', url: { kind: 'literal', value: 'https://blocked.example.com/path' } },
        ]),
        'https://blocked.example.com/private?hidden=yes',
      ),
    ).toEqual({ allowed: false, issueCode: 'POLICY_ORIGIN_BLOCKED' });
    expect(
      evaluateRuntimeOrigin(
        policy,
        workflow([
          { id: 'nav', type: 'navigate', name: 'Navigate', url: { kind: 'literal', value: 'https://safe.example.com' } },
        ]),
        'https://safe.example.com/path',
      ).allowed,
    ).toBe(true);
  });

  it('denies unsafe schemes, credentials and non-loopback HTTP', () => {
    const policy = {
      ...DEFAULT_WORKSPACE_EXECUTION_POLICY,
      network: {
        ...DEFAULT_WORKSPACE_EXECUTION_POLICY.network,
        mode: 'explicit_allowlist' as const,
        allowedOrigins: [{ kind: 'exact' as const, origin: 'https://example.com' }],
        allowLoopbackHttp: false,
      },
    };
    const definition = workflow([
      { id: 'wait', type: 'wait', name: 'Wait', durationMs: 1 },
    ]);
    expect(evaluateRuntimeOrigin(policy, definition, 'javascript:alert(1)')).toMatchObject({ issueCode: 'POLICY_UNSAFE_URL_SCHEME' });
    expect(evaluateRuntimeOrigin(policy, definition, 'https://user:pass@example.com')).toMatchObject({ issueCode: 'POLICY_URL_CREDENTIALS_DENIED' });
    expect(evaluateRuntimeOrigin(policy, definition, 'http://example.com')).toMatchObject({ issueCode: 'POLICY_HTTP_ORIGIN_DENIED' });
  });

  it('requires immediate approval for high risk and never overrides critical deny', () => {
    const submit = {
      id: 'submit',
      type: 'click' as const,
      name: 'Submit',
      locator: { kind: 'testId' as const, value: 'submit' },
      actionIntent: 'submit' as const,
    };
    const missing = evaluate([submit]);
    expect(missing.steps[0]).toMatchObject({
      decision: 'require_approval',
      approvalSatisfied: false,
    });
    const approved = evaluate([
      {
        id: 'approval',
        type: 'approval',
        name: 'Approve submit',
        message: 'Approve this submit.',
        riskLevel: 'high',
        scope: 'next_step',
        timeoutMs: 5_000,
      },
      submit,
    ]);
    expect(approved.steps[1]).toMatchObject({
      decision: 'require_approval',
      approvalSatisfied: true,
    });
    const denied = evaluate([
      {
        id: 'approval',
        type: 'approval',
        name: 'Approve delete',
        message: 'Approve this delete.',
        riskLevel: 'critical',
        scope: 'next_step',
        timeoutMs: 5_000,
      },
      { ...submit, actionIntent: 'delete' },
    ]);
    expect(denied.steps[1]).toMatchObject({
      decision: 'deny',
      approvalSatisfied: false,
    });
  });

  it('canonicalizes equivalent policies and keeps evaluations value-free', () => {
    const first = {
      ...DEFAULT_WORKSPACE_EXECUTION_POLICY,
      network: {
        ...DEFAULT_WORKSPACE_EXECUTION_POLICY.network,
        allowedOrigins: [
          { kind: 'exact' as const, origin: 'https://example.com' },
          { kind: 'exact' as const, origin: 'https://example.com' },
        ],
      },
      rules: [
        {
          id: 'b-rule',
          match: { stepTypes: ['click' as const] },
          decision: 'allow' as const,
        },
        {
          id: 'a-rule',
          match: { actionIntents: ['submit' as const] },
          minimumRisk: 'high' as const,
        },
      ],
    };
    const second = {
      ...first,
      network: {
        ...first.network,
        allowedOrigins: [
          { kind: 'exact' as const, origin: 'https://example.com/' },
        ],
      },
      rules: [...first.rules].reverse(),
    };
    expect(digest(canonicalPolicyJson(first))).toBe(
      digest(canonicalPolicyJson(second)),
    );
    expect(digest(canonicalPolicyJson(DEFAULT_WORKSPACE_EXECUTION_POLICY))).toBe(
      'e1ced8bdc41f0ee58dce35c2af885982dd1381c6ef41e172331fd17697748d13',
    );
    const result = evaluate([
      {
        id: 'fill',
        type: 'fill',
        name: 'Fill',
        locator: { kind: 'label', value: 'Safe label' },
        value: { kind: 'literal', value: 'must-not-appear' },
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('must-not-appear');
    expect(JSON.stringify(result)).not.toContain('Safe label');
  });
});
