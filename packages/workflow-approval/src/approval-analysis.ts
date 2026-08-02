import {
  WorkflowDefinitionSchema,
  type WorkflowDefinition,
} from '@tasktwin/workflow-schema';

import {
  WorkflowApprovalAnalysisSchema,
  type ApprovalAnalysisIssue,
  type ApprovalBinding,
  type WorkflowApprovalAnalysis,
} from './contracts.js';
import { WORKFLOW_APPROVAL_SCHEMA_VERSION } from './constants.js';

export function analyzeWorkflowApprovals(
  input: unknown,
): WorkflowApprovalAnalysis {
  const workflow = WorkflowDefinitionSchema.safeParse(input);
  if (!workflow.success) {
    return WorkflowApprovalAnalysisSchema.parse({
      schemaVersion: WORKFLOW_APPROVAL_SCHEMA_VERSION,
      bindings: [],
      issues: [],
      hasBlockingIssues: false,
    });
  }

  const bindings: ApprovalBinding[] = [];
  const issues: ApprovalAnalysisIssue[] = [];
  workflow.data.steps.forEach((step, stepIndex) => {
    if (step.type !== 'approval') return;
    const gatedStep = workflow.data.steps[stepIndex + 1];
    if (gatedStep === undefined) {
      issues.push({
        code: 'APPROVAL_STEP_ORPHANED',
        message: 'An Approval step must gate an immediate following step.',
        path: ['steps', stepIndex],
        stepId: step.id,
        stepIndex,
      });
      return;
    }
    bindings.push({
      approvalStepId: step.id,
      approvalStepIndex: stepIndex,
      gatedStepId: gatedStep.id,
      gatedStepIndex: stepIndex + 1,
      riskLevel: step.riskLevel,
      timeoutMs: step.timeoutMs,
    });
  });

  return WorkflowApprovalAnalysisSchema.parse({
    schemaVersion: WORKFLOW_APPROVAL_SCHEMA_VERSION,
    bindings,
    issues,
    hasBlockingIssues: issues.length > 0,
  });
}

export function requireApprovalBinding(
  workflow: WorkflowDefinition,
  approvalStepId: string,
  gatedStepId?: string,
): ApprovalBinding {
  const analysis = analyzeWorkflowApprovals(workflow);
  const binding = analysis.bindings.find(
    (candidate) => candidate.approvalStepId === approvalStepId,
  );
  if (
    binding === undefined ||
    binding.gatedStepId !== (gatedStepId ?? binding.gatedStepId)
  ) {
    throw new Error('Approval binding is invalid.');
  }
  return binding;
}
