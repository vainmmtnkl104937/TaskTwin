import type {
  WorkflowActionIntent,
  WorkflowStep,
} from '@tasktwin/workflow-schema';

import type { PolicyDecision, PolicyRiskLevel } from './contracts.js';

const RISK_STRENGTH: Record<PolicyRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const DECISION_STRENGTH: Record<PolicyDecision, number> = {
  allow: 0,
  require_approval: 1,
  deny: 2,
};

export function strongerRisk(
  left: PolicyRiskLevel,
  right: PolicyRiskLevel,
): PolicyRiskLevel {
  return RISK_STRENGTH[left] >= RISK_STRENGTH[right] ? left : right;
}

export function strongerDecision(
  left: PolicyDecision,
  right: PolicyDecision,
): PolicyDecision {
  return DECISION_STRENGTH[left] >= DECISION_STRENGTH[right] ? left : right;
}

export function riskAtLeast(
  value: PolicyRiskLevel,
  threshold: PolicyRiskLevel,
): boolean {
  return RISK_STRENGTH[value] >= RISK_STRENGTH[threshold];
}

export function deriveActionIntent(step: WorkflowStep): WorkflowActionIntent {
  switch (step.type) {
    case 'wait':
    case 'extract':
    case 'verify':
      return 'read';
    case 'navigate':
      return 'navigate';
    case 'fill':
      return 'enter_data';
    case 'select':
    case 'setChecked':
      return 'change_state';
    case 'approval':
      return 'approval_gate';
    case 'click':
      return step.actionIntent ?? 'unknown';
  }
}

export function baseRiskForIntent(
  intent: WorkflowActionIntent,
  unknownRisk: PolicyRiskLevel,
): PolicyRiskLevel {
  switch (intent) {
    case 'read':
    case 'navigate':
    case 'approval_gate':
      return 'low';
    case 'enter_data':
    case 'change_state':
      return 'medium';
    case 'submit':
    case 'send':
      return 'high';
    case 'delete':
    case 'purchase':
    case 'permission_change':
      return 'critical';
    case 'unknown':
      return unknownRisk;
  }
}
