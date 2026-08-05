export const WORKFLOW_POLICY_SCHEMA_VERSION = 1;
export const MAX_POLICY_ORIGIN_PATTERNS = 64;
export const MAX_POLICY_RULES = 128;
export const MAX_POLICY_ISSUES = 2_000;

export const DEFAULT_WORKSPACE_EXECUTION_POLICY: WorkspaceExecutionPolicyDefinition = {
  schemaVersion: 1,
  network: {
    mode: 'workflow_declared_origins',
    allowedOrigins: [],
    blockedOrigins: [],
    allowLoopbackHttp: true,
  },
  unknownActionRisk: 'medium',
  approval: {
    threshold: 'high_or_above',
    criticalActionBehavior: 'deny',
  },
  rules: [],
};
import type { WorkspaceExecutionPolicyDefinition } from './contracts.js';
