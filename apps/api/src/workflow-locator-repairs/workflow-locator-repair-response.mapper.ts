import type {
  WorkflowLocatorRepairAccess,
  WorkflowLocatorRepairProposalRecord,
} from '@tasktwin/database';
import {
  LocatorRepairProposalAccessSchema,
  SafeLocatorRepairProposalSchema,
} from '@tasktwin/workflow-locator-repair';

export function safeLocatorRepairAccess(access: WorkflowLocatorRepairAccess) {
  return LocatorRepairProposalAccessSchema.parse({
    role: access.role,
    canTest: access.role !== 'VIEWER',
    canApply: access.role !== 'VIEWER',
  });
}

export function safeLocatorRepairProposal(
  record: WorkflowLocatorRepairProposalRecord,
) {
  return SafeLocatorRepairProposalSchema.parse({
    id: record.id,
    workspaceId: record.workspaceId,
    workflowRunId: record.workflowRunId,
    workflowId: record.workflowId,
    sourceWorkflowVersionId: record.sourceWorkflowVersionId,
    sourceWorkflowVersion: record.sourceWorkflowVersion,
    repairRequestId: record.workflowRepairRequestId,
    step: record.step,
    failedAttemptNumber: record.failedAttemptNumber,
    status: record.status,
    candidates: record.candidates.map((candidate) => ({
      id: candidate.id,
      rank: candidate.rank,
      strategy: candidate.strategy,
      score: candidate.score,
      confidence: candidate.confidence,
      evidenceCodes: candidate.evidenceCodes,
      privacyClassification: candidate.privacyClassification,
      privacyRuleIds: candidate.privacyRuleIds,
      testStatus: candidate.testStatus,
      testedAt: candidate.testedAt?.toISOString() ?? null,
    })),
    selectedCandidateId: record.selectedCandidateId,
    appliedDraftVersionId: record.appliedDraftVersionId,
    appliedDraftRevision: record.appliedDraftRevision,
    expiresAt: record.expiresAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
  });
}
