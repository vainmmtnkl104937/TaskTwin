import { describe, expect, it } from 'vitest';

import {
  analyzeWorkflowApprovals,
  canTransitionApprovalRequest,
  createSafeApprovalSummary,
  requireApprovalBinding,
} from '../src/index.js';

function workflow(approvalLast = false) {
  const approval = {
    id: 'approveSubmit',
    type: 'approval' as const,
    name: 'Approve submit',
    message: 'Review the static action.',
    riskLevel: 'high' as const,
    scope: 'next_step' as const,
    timeoutMs: 30_000,
  };
  const submit = {
    id: 'submit',
    type: 'click' as const,
    name: 'Submit',
    locator: { kind: 'testId' as const, value: 'submit' },
  };
  return {
    schemaVersion: 1 as const,
    workflowId: 'approvalWorkflow',
    version: 1,
    name: 'Approval workflow',
    status: 'published' as const,
    variables: [],
    steps: approvalLast ? [submit, approval] : [approval, submit],
  };
}

describe('workflow approval', () => {
  it('binds an Approval step only to its immediate next step', () => {
    const definition = workflow();
    const analysis = analyzeWorkflowApprovals(definition);
    expect(analysis.hasBlockingIssues).toBe(false);
    expect(analysis.bindings).toEqual([
      expect.objectContaining({
        approvalStepId: 'approveSubmit',
        approvalStepIndex: 0,
        gatedStepId: 'submit',
        gatedStepIndex: 1,
      }),
    ]);
    expect(
      requireApprovalBinding(definition, 'approveSubmit', 'submit'),
    ).toBeDefined();
    expect(() =>
      requireApprovalBinding(definition, 'approveSubmit', 'anotherStep'),
    ).toThrow('Approval binding is invalid.');
  });

  it('rejects an Approval step without a following step deterministically', () => {
    const analysis = analyzeWorkflowApprovals(workflow(true));
    expect(analysis.bindings).toEqual([]);
    expect(analysis.issues.map((issue) => issue.code)).toEqual([
      'APPROVAL_STEP_ORPHANED',
    ]);
  });

  it('allows transitions only from PENDING', () => {
    for (const terminal of [
      'APPROVED',
      'REJECTED',
      'EXPIRED',
      'CANCELLED',
      'INVALIDATED',
    ] as const) {
      expect(canTransitionApprovalRequest('PENDING', terminal)).toBe(true);
      expect(canTransitionApprovalRequest(terminal, 'APPROVED')).toBe(false);
    }
  });

  it('creates a safe summary without message or workflow data', () => {
    const summary = createSafeApprovalSummary({
      approvalStepId: 'approveSubmit',
      gatedStepId: 'submit',
      riskLevel: 'high',
      status: 'PENDING',
    });
    expect(JSON.stringify(summary)).not.toContain('Review');
    expect(summary).toEqual({
      schemaVersion: 1,
      approvalStepId: 'approveSubmit',
      gatedStepId: 'submit',
      riskLevel: 'high',
      status: 'PENDING',
    });
  });
});
