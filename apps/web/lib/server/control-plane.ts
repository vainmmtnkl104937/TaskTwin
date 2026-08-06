import 'server-only';

import type { z } from 'zod';
import {
  ApplyLocatorRepairToDraftResponseSchema,
  LocatorRepairCandidateTestRequestResponseSchema,
  LocatorRepairProposalDetailResponseSchema,
  LocatorRepairProposalListResponseSchema,
} from '@tasktwin/workflow-locator-repair';

import {
  LoginResponseSchema,
  PairingActionResponseSchema,
  PairingInspectionResponseSchema,
  RunnerDeviceListResponseSchema,
  RunnerDeviceRevokeResponseSchema,
  WorkflowLifecycleActionResponseSchema,
  WorkflowVersionDetailResponseSchema,
  WorkflowVersionHistoryResponseSchema,
  WorkspaceListResponseSchema,
  WorkspaceWorkflowListResponseSchema,
  CreateWorkflowRunResponseSchema,
  RunInputPreparationResponseSchema,
  WorkflowRunCancellationResponseSchema,
  WorkflowRunDetailResponseSchema,
  WorkflowRunListResponseSchema,
  ApprovalDecisionResponseSchema,
  ApprovalRequestDetailResponseSchema,
  ApprovalRequestListResponseSchema,
  RepairDecisionResponseSchema,
  RepairRequestDetailResponseSchema,
  RepairRequestListResponseSchema,
  ActiveExecutionPolicyResponseSchema,
  ExecutionPolicyVersionListResponseSchema,
  CreateExecutionPolicyVersionResponseSchema,
  AuditEventListResponseSchema,
  AuditEventDetailResponseSchema,
  AuditVerifyResponseSchema,
  RunEvidenceResponseSchema,
  type AuditEventListResponse,
  type AuditEventDetailResponse,
  type AuditVerifyRequest,
  type AuditVerifyResponse,
  type RunEvidenceResponse,
  WorkflowScheduleListResponseSchema,
  WorkflowScheduleResponseSchema,
  OccurrenceListResponseSchema,
  CreateWorkflowScheduleResponseSchema,
} from '../control-plane-contracts';
import type { WorkspaceExecutionPolicyDefinition } from '@tasktwin/workflow-policy';
import { getControlPlaneOrigin } from './environment';

export class ControlPlaneError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`Control Plane request failed with status ${status}.`);
    this.name = 'ControlPlaneError';
  }
}

async function request<Response>(
  path: string,
  schema: z.ZodType<Response>,
  init: RequestInit,
): Promise<Response> {
  const response = await fetch(`${getControlPlaneOrigin()}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      ...init.headers,
    },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ControlPlaneError(response.status, body);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new Error('The Control Plane returned an invalid response.');
  }
  return parsed.data;
}

export function login(email: string, password: string) {
  return request('/auth/login', LoginResponseSchema, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function listWorkspaces(accessToken: string) {
  return request('/workspaces', WorkspaceListResponseSchema, {
    method: 'GET',
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

export function getExecutionPolicy(accessToken: string, workspaceId: string) {
  return request(
    `/workspaces/${encodeURIComponent(workspaceId)}/execution-policy`,
    ActiveExecutionPolicyResponseSchema,
    { method: 'GET', headers: { authorization: `Bearer ${accessToken}` } },
  );
}

export function listExecutionPolicyVersions(
  accessToken: string,
  workspaceId: string,
) {
  return request(
    `/workspaces/${encodeURIComponent(workspaceId)}/execution-policy/versions`,
    ExecutionPolicyVersionListResponseSchema,
    { method: 'GET', headers: { authorization: `Bearer ${accessToken}` } },
  );
}

export function createExecutionPolicyVersion(
  accessToken: string,
  workspaceId: string,
  input: {
    clientVersionId: string;
    expectedActiveRevision: number;
    definition: WorkspaceExecutionPolicyDefinition;
  },
) {
  return request(
    `/workspaces/${encodeURIComponent(workspaceId)}/execution-policy/versions`,
    CreateExecutionPolicyVersionResponseSchema,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(input),
    },
  );
}

export function inspectRunnerPairing(accessToken: string, userCode: string) {
  return request('/runner-pairing/inspect', PairingInspectionResponseSchema, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ schemaVersion: 1, userCode }),
  });
}

export function approveRunnerPairing(
  accessToken: string,
  workspaceId: string,
  userCode: string,
) {
  return request(
    `/workspaces/${encodeURIComponent(workspaceId)}/runner-pairing/approve`,
    PairingActionResponseSchema,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ schemaVersion: 1, userCode }),
    },
  );
}

export function denyRunnerPairing(
  accessToken: string,
  workspaceId: string,
  userCode: string,
) {
  return request('/runner-pairing/deny', PairingActionResponseSchema, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ schemaVersion: 1, workspaceId, userCode }),
  });
}

export function listRunnerDevices(accessToken: string, workspaceId: string) {
  return request(
    `/workspaces/${encodeURIComponent(workspaceId)}/runner-devices`,
    RunnerDeviceListResponseSchema,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );
}

export function revokeRunnerDevice(
  accessToken: string,
  runnerDeviceId: string,
) {
  return request(
    `/runner-devices/${encodeURIComponent(runnerDeviceId)}/revoke`,
    RunnerDeviceRevokeResponseSchema,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: '{}',
    },
  );
}

export function listWorkflows(accessToken: string, workspaceId: string) {
  return request(
    `/workspaces/${encodeURIComponent(workspaceId)}/workflows`,
    WorkspaceWorkflowListResponseSchema,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );
}

export function getWorkflowVersion(
  accessToken: string,
  workflowVersionId: string,
) {
  return request(
    `/workflow-versions/${encodeURIComponent(workflowVersionId)}`,
    WorkflowVersionDetailResponseSchema,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );
}

export function patchWorkflowDraft(
  accessToken: string,
  workflowVersionId: string,
  expectedRevision: number,
  definition: unknown,
) {
  return request(
    `/workflow-versions/${encodeURIComponent(workflowVersionId)}/draft`,
    WorkflowVersionDetailResponseSchema,
    {
      method: 'PATCH',
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ expectedRevision, definition }),
    },
  );
}

export function listWorkflowVersions(accessToken: string, workflowId: string) {
  return request(
    `/workflows/${encodeURIComponent(workflowId)}/versions`,
    WorkflowVersionHistoryResponseSchema,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );
}

function postLifecycleAction(accessToken: string, path: string, body: unknown) {
  return request(path, WorkflowLifecycleActionResponseSchema, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
}

export function submitWorkflowVersionForTesting(
  accessToken: string,
  workflowVersionId: string,
  expectedRevision: number,
) {
  return postLifecycleAction(
    accessToken,
    `/workflow-versions/${encodeURIComponent(workflowVersionId)}/submit-for-testing`,
    { expectedRevision },
  );
}

export function returnWorkflowVersionToDraft(
  accessToken: string,
  workflowVersionId: string,
  expectedRevision: number,
) {
  return postLifecycleAction(
    accessToken,
    `/workflow-versions/${encodeURIComponent(workflowVersionId)}/return-to-draft`,
    { expectedRevision },
  );
}

export function publishWorkflowVersion(
  accessToken: string,
  workflowVersionId: string,
  expectedRevision: number,
) {
  return postLifecycleAction(
    accessToken,
    `/workflow-versions/${encodeURIComponent(workflowVersionId)}/publish`,
    { expectedRevision },
  );
}

export function archiveWorkflowVersion(
  accessToken: string,
  workflowVersionId: string,
) {
  return postLifecycleAction(
    accessToken,
    `/workflow-versions/${encodeURIComponent(workflowVersionId)}/archive`,
    {},
  );
}

export function createWorkflowDraftVersion(
  accessToken: string,
  workflowId: string,
  sourceVersionId: string,
  clientCreationId: string,
) {
  return postLifecycleAction(
    accessToken,
    `/workflows/${encodeURIComponent(workflowId)}/versions`,
    { sourceVersionId, clientCreationId },
  );
}

export function createWorkflowRun(
  accessToken: string,
  workflowVersionId: string,
  runnerDeviceId: string,
  clientRunId: string,
  recoveryMode:
    | 'automatic_safe_only'
    | 'automatic_safe_and_manual'
    | 'automatic_safe_and_locator_proposals',
) {
  return request(
    `/workflow-versions/${encodeURIComponent(workflowVersionId)}/runs`,
    CreateWorkflowRunResponseSchema,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        schemaVersion: 1,
        runnerDeviceId,
        clientRunId,
        options: {
          totalTimeoutMs: 120_000,
          stepTimeoutMs: 30_000,
          recoveryMode,
        },
      }),
    },
  );
}

export function prepareWorkflowRunInputs(
  accessToken: string,
  workflowVersionId: string,
  input: {
    clientPreparationId: string;
    clientRunId: string;
    runnerDeviceId: string;
    options: {
      totalTimeoutMs: number;
      stepTimeoutMs: number;
      recoveryMode:
        | 'automatic_safe_only'
        | 'automatic_safe_and_manual'
        | 'automatic_safe_and_locator_proposals';
    };
  },
) {
  return request(
    `/workflow-versions/${encodeURIComponent(workflowVersionId)}/run-preparations`,
    RunInputPreparationResponseSchema,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ schemaVersion: 1, ...input }),
    },
  );
}

export function commitWorkflowRunInputs(
  accessToken: string,
  preparationId: string,
  envelope: unknown,
) {
  return request(
    `/run-preparations/${encodeURIComponent(preparationId)}/commit`,
    CreateWorkflowRunResponseSchema,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ schemaVersion: 1, envelope }),
    },
  );
}

export function listWorkflowRuns(accessToken: string, workspaceId: string) {
  return request(
    `/workspaces/${encodeURIComponent(workspaceId)}/workflow-runs`,
    WorkflowRunListResponseSchema,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );
}

export function getWorkflowRun(accessToken: string, workflowRunId: string) {
  return request(
    `/workflow-runs/${encodeURIComponent(workflowRunId)}`,
    WorkflowRunDetailResponseSchema,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );
}

export function cancelWorkflowRun(accessToken: string, workflowRunId: string) {
  return request(
    `/workflow-runs/${encodeURIComponent(workflowRunId)}/cancel`,
    WorkflowRunCancellationResponseSchema,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ schemaVersion: 1 }),
    },
  );
}

export function listApprovalRequests(accessToken: string, workspaceId: string) {
  return request(
    `/workspaces/${encodeURIComponent(workspaceId)}/approval-requests`,
    ApprovalRequestListResponseSchema,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );
}

export function getApprovalRequest(
  accessToken: string,
  approvalRequestId: string,
) {
  return request(
    `/approval-requests/${encodeURIComponent(approvalRequestId)}`,
    ApprovalRequestDetailResponseSchema,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );
}

export function decideApprovalRequest(
  accessToken: string,
  approvalRequestId: string,
  decision: 'approve' | 'reject',
  clientDecisionId: string,
) {
  return request(
    `/approval-requests/${encodeURIComponent(approvalRequestId)}/${decision}`,
    ApprovalDecisionResponseSchema,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ clientDecisionId }),
    },
  );
}

export function listRepairRequests(accessToken: string, workspaceId: string) {
  return request(
    `/workspaces/${encodeURIComponent(workspaceId)}/repair-requests`,
    RepairRequestListResponseSchema,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );
}

export function getRepairRequest(accessToken: string, repairRequestId: string) {
  return request(
    `/repair-requests/${encodeURIComponent(repairRequestId)}`,
    RepairRequestDetailResponseSchema,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );
}

export function decideRepairRequest(
  accessToken: string,
  repairRequestId: string,
  decision: 'retry' | 'abort',
  clientDecisionId: string,
) {
  return request(
    `/repair-requests/${encodeURIComponent(repairRequestId)}/${decision}`,
    RepairDecisionResponseSchema,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ clientDecisionId }),
    },
  );
}

export function listLocatorRepairProposals(
  accessToken: string,
  workspaceId: string,
) {
  return request(
    `/workspaces/${encodeURIComponent(workspaceId)}/locator-repair-proposals`,
    LocatorRepairProposalListResponseSchema,
    { method: 'GET', headers: { authorization: `Bearer ${accessToken}` } },
  );
}

export function getLocatorRepairProposal(
  accessToken: string,
  proposalId: string,
) {
  return request(
    `/locator-repair-proposals/${encodeURIComponent(proposalId)}`,
    LocatorRepairProposalDetailResponseSchema,
    { method: 'GET', headers: { authorization: `Bearer ${accessToken}` } },
  );
}

export function requestLocatorRepairCandidateTest(
  accessToken: string,
  candidateId: string,
  clientTestRequestId: string,
) {
  return request(
    `/locator-repair-candidates/${encodeURIComponent(candidateId)}/test`,
    LocatorRepairCandidateTestRequestResponseSchema,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ schemaVersion: 1, clientTestRequestId }),
    },
  );
}

export function applyLocatorRepairCandidate(
  accessToken: string,
  proposalId: string,
  input: {
    clientApplyId: string;
    candidateId: string;
    targetDraftVersionId: string;
    expectedRevision: number;
  },
) {
  return request(
    `/locator-repair-proposals/${encodeURIComponent(proposalId)}/apply`,
    ApplyLocatorRepairToDraftResponseSchema,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ schemaVersion: 1, ...input }),
    },
  );
}

function buildAuditQueryString(
  filters: {
    eventTypes?: string[];
    actorKinds?: ('user' | 'runner' | 'system')[];
    primaryEntityKind?: string;
    primaryEntityId?: string;
    correlationId?: string;
    fromOccurredAt?: string;
    toOccurredAt?: string;
    fromSequence?: number;
    toSequence?: number;
    limit?: number;
    cursor?: string;
  },
): string {
  const params = new URLSearchParams();
  if (filters.eventTypes) {
    for (const value of filters.eventTypes) {
      params.append('eventTypes', value);
    }
  }
  if (filters.actorKinds) {
    for (const value of filters.actorKinds) {
      params.append('actorKinds', value);
    }
  }
  if (filters.primaryEntityKind) {
    params.set('primaryEntityKind', filters.primaryEntityKind);
  }
  if (filters.primaryEntityId) {
    params.set('primaryEntityId', filters.primaryEntityId);
  }
  if (filters.correlationId) {
    params.set('correlationId', filters.correlationId);
  }
  if (filters.fromOccurredAt) {
    params.set('fromOccurredAt', filters.fromOccurredAt);
  }
  if (filters.toOccurredAt) {
    params.set('toOccurredAt', filters.toOccurredAt);
  }
  if (filters.fromSequence !== undefined) {
    params.set('fromSequence', String(filters.fromSequence));
  }
  if (filters.toSequence !== undefined) {
    params.set('toSequence', String(filters.toSequence));
  }
  if (filters.limit !== undefined) {
    params.set('limit', String(filters.limit));
  }
  if (filters.cursor) {
    params.set('cursor', filters.cursor);
  }
  const query = params.toString();
  return query.length === 0 ? '' : `?${query}`;
}

export function listAuditEvents(
  accessToken: string,
  workspaceId: string,
  filters: {
    eventTypes?: string[];
    actorKinds?: ('user' | 'runner' | 'system')[];
    primaryEntityKind?: string;
    primaryEntityId?: string;
    correlationId?: string;
    fromOccurredAt?: string;
    toOccurredAt?: string;
    fromSequence?: number;
    toSequence?: number;
    limit?: number;
    cursor?: string;
  } = {},
): Promise<AuditEventListResponse> {
  const query = buildAuditQueryString(filters);
  return request(
    `/workspaces/${encodeURIComponent(workspaceId)}/audit-events${query}`,
    AuditEventListResponseSchema,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );
}

export function getAuditEvent(
  accessToken: string,
  auditEventId: string,
): Promise<AuditEventDetailResponse> {
  return request(
    `/audit-events/${encodeURIComponent(auditEventId)}`,
    AuditEventDetailResponseSchema,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );
}

export function verifyAuditTrail(
  accessToken: string,
  workspaceId: string,
  input: AuditVerifyRequest,
): Promise<AuditVerifyResponse> {
  return request(
    `/workspaces/${encodeURIComponent(workspaceId)}/audit-trail/verify`,
    AuditVerifyResponseSchema,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ schemaVersion: 1, ...input }),
    },
  );
}

export function getRunEvidence(
  accessToken: string,
  workflowRunId: string,
): Promise<RunEvidenceResponse> {
  return request(
    `/workflow-runs/${encodeURIComponent(workflowRunId)}/evidence`,
    RunEvidenceResponseSchema,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );
}

export function createWorkflowSchedule(
  accessToken: string,
  workflowVersionId: string,
  request_2: {
    clientScheduleId: string;
    name: string;
    definition: unknown;
    runnerDeviceId: string;
    overlapPolicy?: 'skip';
    misfirePolicy?: 'skip';
    maxStartDelaySeconds?: number;
  },
): Promise<{
  schemaVersion: 1;
  schedule: unknown;
}> {
  return request(
    `/workflow-versions/${encodeURIComponent(workflowVersionId)}/schedules`,
    CreateWorkflowScheduleResponseSchema,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ schemaVersion: 1, ...request_2 }),
    },
  );
}

export function listWorkflowSchedules(
  accessToken: string,
  workspaceId: string,
) {
  return request(
    `/workspaces/${encodeURIComponent(workspaceId)}/workflow-schedules`,
    WorkflowScheduleListResponseSchema,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );
}

export function getWorkflowSchedule(
  accessToken: string,
  scheduleId: string,
) {
  return request(
    `/workflow-schedules/${encodeURIComponent(scheduleId)}`,
    WorkflowScheduleResponseSchema,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );
}

export function listScheduleOccurrences(
  accessToken: string,
  scheduleId: string,
  limit?: number,
  before?: string,
) {
  const params = new URLSearchParams();
  if (limit !== undefined) params.set('limit', String(limit));
  if (before !== undefined) params.set('before', before);
  const query = params.toString() ? `?${params.toString()}` : '';
  return request(
    `/workflow-schedules/${encodeURIComponent(scheduleId)}/occurrences${query}`,
    OccurrenceListResponseSchema,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );
}

export function pauseWorkflowSchedule(
  accessToken: string,
  scheduleId: string,
) {
  return request(
    `/workflow-schedules/${encodeURIComponent(scheduleId)}/pause`,
    WorkflowScheduleResponseSchema,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ schemaVersion: 1 }),
    },
  );
}

export function resumeWorkflowSchedule(
  accessToken: string,
  scheduleId: string,
) {
  return request(
    `/workflow-schedules/${encodeURIComponent(scheduleId)}/resume`,
    WorkflowScheduleResponseSchema,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ schemaVersion: 1 }),
    },
  );
}

export function archiveWorkflowSchedule(
  accessToken: string,
  scheduleId: string,
) {
  return request(
    `/workflow-schedules/${encodeURIComponent(scheduleId)}/archive`,
    WorkflowScheduleResponseSchema,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ schemaVersion: 1 }),
    },
  );
}
