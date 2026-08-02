import type { ApprovalRiskLevel } from '@tasktwin/workflow-schema';

import {
  SafeApprovalSummarySchema,
  type ApprovalRequestStatus,
  type SafeApprovalSummary,
} from './contracts.js';
import { WORKFLOW_APPROVAL_SCHEMA_VERSION } from './constants.js';

export function createSafeApprovalSummary(input: {
  approvalStepId: string;
  gatedStepId: string;
  riskLevel: ApprovalRiskLevel;
  status: ApprovalRequestStatus;
}): SafeApprovalSummary {
  return SafeApprovalSummarySchema.parse({
    schemaVersion: WORKFLOW_APPROVAL_SCHEMA_VERSION,
    ...input,
  });
}
