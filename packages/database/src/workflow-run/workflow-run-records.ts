import type {
  WorkflowExecutionResult,
  WorkflowProgressEvent,
} from '@tasktwin/workflow-engine';
import type {
  PersistedRunStepStatus,
  WorkflowRunReadinessReport,
  WorkflowRunStatus,
} from '@tasktwin/run-protocol';
import type { WorkflowDefinition } from '@tasktwin/workflow-schema';

export interface WorkflowRunStepRecord {
  stepId: string;
  stepIndex: number;
  stepType: string;
  status: PersistedRunStepStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  errorCode: string | null;
  skippedReason: string | null;
}

export interface WorkflowRunRecord {
  id: string;
  workspaceId: string;
  workflowId: string;
  workflowVersionId: string;
  workflowVersion: number;
  runnerDeviceId: string;
  createdByUserId: string;
  clientRunId: string;
  status: WorkflowRunStatus;
  definitionDigest: string;
  lastProgressSequence: number;
  createdAt: Date;
  updatedAt: Date;
  claimedAt: Date | null;
  startedAt: Date | null;
  cancelRequestedAt: Date | null;
  finishedAt: Date | null;
  terminationCause: string | null;
  steps: WorkflowRunStepRecord[];
}

export interface WorkflowRunAccess {
  organizationId: string;
  userId: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
}

export interface CreateWorkflowRunResult {
  run: WorkflowRunRecord;
  idempotent: boolean;
  readiness: WorkflowRunReadinessReport;
}

export type ClaimWorkflowRunResult =
  | { status: 'no_job' }
  | {
      status: 'claimed';
      runId: string;
      workflow: WorkflowDefinition;
      definitionDigest: string;
      allowedOrigins: string[];
      options: { totalTimeoutMs: number; stepTimeoutMs: number };
      leaseExpiresAt: Date;
      idempotent: boolean;
    };

export interface ProgressEventInput {
  sequence: number;
  event: WorkflowProgressEvent;
}

export interface ProgressBatchResult {
  acceptedThroughSequence: number;
  idempotent: boolean;
  cancelRequested: boolean;
}

export interface CompletionResult {
  run: WorkflowRunRecord;
  idempotent: boolean;
}

export interface CompletionInput {
  clientCompletionId: string;
  digest: string;
  result: WorkflowExecutionResult;
}

export interface WorkflowRunListRecord {
  workspaceId: string;
  access: WorkflowRunAccess;
  runs: WorkflowRunRecord[];
}
