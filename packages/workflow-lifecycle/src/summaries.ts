import {
  SafeWorkflowLifecycleSummarySchema,
  type PublishReadinessReport,
  type SafeWorkflowLifecycleSummary,
} from './contracts.js';
import type { WorkflowLifecycleStatus } from '@tasktwin/workflow-schema';

export function summarizeWorkflowLifecycle(input: {
  workflowId: string;
  workflowVersion: number;
  revision: number;
  status: WorkflowLifecycleStatus;
  readiness: PublishReadinessReport;
}): SafeWorkflowLifecycleSummary {
  return SafeWorkflowLifecycleSummarySchema.parse({
    schemaVersion: 1,
    workflowId: input.workflowId,
    workflowVersion: input.workflowVersion,
    revision: input.revision,
    status: input.status,
    readiness: input.readiness.summary,
  });
}
