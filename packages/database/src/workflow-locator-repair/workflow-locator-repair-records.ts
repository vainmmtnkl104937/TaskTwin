import type { OrganizationRole } from '../generated/prisma/client.js';
import type {
  LocatorRepairCandidateTestStatusSchema,
  LocatorRepairElementKind,
  LocatorRepairEvidenceCode,
} from '@tasktwin/workflow-locator-repair';
import type { ElementLocator } from '@tasktwin/workflow-schema';
import type { z } from 'zod';

export interface WorkflowLocatorRepairAccess {
  userId: string;
  organizationId: string;
  workspaceId: string;
  role: OrganizationRole;
}

export interface WorkflowLocatorRepairCandidateRecord {
  id: string;
  clientCandidateId: string;
  locator: ElementLocator;
  locatorDigest: string;
  rank: number;
  strategy: string;
  confidence: 'high' | 'medium' | 'low';
  score: number;
  elementKind: LocatorRepairElementKind;
  reasonCodes: string[];
  evidenceCodes: LocatorRepairEvidenceCode[];
  privacyClassification: string;
  privacyRuleIds: string[];
  testStatus: z.infer<typeof LocatorRepairCandidateTestStatusSchema>;
  clientTestRequestId: string | null;
  testRequestedAt: Date | null;
  clientTestResultId: string | null;
  testObservations: string[];
  testedAt: Date | null;
}

export interface WorkflowLocatorRepairProposalRecord {
  id: string;
  workspaceId: string;
  workflowRunId: string;
  workflowId: string;
  workflowName: string;
  sourceWorkflowVersionId: string;
  sourceWorkflowVersion: number;
  runnerDeviceId: string;
  workflowRepairRequestId: string;
  step: { id: string; index: number; name: string; type: string };
  failedAttemptNumber: number;
  sourceStepDigest: string;
  sourceLocatorDigest: string;
  pageContextDigest: string;
  status: 'OPEN' | 'READY' | 'APPLIED' | 'EXPIRED' | 'INVALIDATED';
  selectedCandidateId: string | null;
  appliedDraftVersionId: string | null;
  appliedDraftRevision: number | null;
  expiresAt: Date;
  createdAt: Date;
  candidates: WorkflowLocatorRepairCandidateRecord[];
}
