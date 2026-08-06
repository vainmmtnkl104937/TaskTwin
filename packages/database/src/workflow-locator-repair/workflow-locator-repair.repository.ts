import {
  LocatorObservationSchema,
  calculateLocatorConfidence,
  canonicalizeLocator,
  rankLocatorBundle,
  scoreLocatorObservation,
} from '@tasktwin/locator-engine';
import { RecordingConversionReportSchema } from '@tasktwin/recording-converter';
import {
  ApplyLocatorRepairToDraftRequestSchema,
  LocatorRepairCandidateTestRequestSchema,
  LocatorRepairCandidateTestStatusSchema,
  LocatorRepairDiscoverySeedSchema,
  LocatorRepairEvidenceCodeSchema,
  RunnerLocatorRepairCandidateTestResultSchema,
  RunnerLocatorRepairProposalCreateSchema,
  assessLocatorRepairEligibility,
  isLocatorCandidatePrivacyEligible,
  isLocatorCompatibleWithStep,
  locatorForWorkflowStep,
  replaceWorkflowStepLocator,
  type ApplyLocatorRepairToDraftRequest,
  type LocatorRepairDiscoverySeed,
  type RunnerLocatorRepairCandidateTestResult,
  type RunnerLocatorRepairProposalCreate,
} from '@tasktwin/workflow-locator-repair';
import { isApprovalGatedStep } from '@tasktwin/workflow-recovery';
import {
  ElementLocatorSchema,
  WorkflowDefinitionSchema,
  type ElementLocator,
  type WorkflowStep,
} from '@tasktwin/workflow-schema';
import { validateEditorWorkflow } from '@tasktwin/workflow-editor-core';
import { analyzePublishReadiness } from '@tasktwin/workflow-lifecycle';
import { WorkspaceExecutionPolicyDefinitionSchema } from '@tasktwin/workflow-policy';
import { z } from 'zod';
import {
  createAuditSourceId,
  type AuditEventInput,
} from '@tasktwin/audit-trail';

import {
  OrganizationRole,
  Prisma,
  WorkflowLocatorRepairCandidateTestStatus,
  WorkflowLocatorRepairProposalStatus,
  WorkflowRepairRequestStatus,
  WorkflowRunStatus,
  type PrismaClient,
} from '../generated/prisma/client.js';
import {
  appendAuditEventTransactional,
  auditHasherForTrail,
} from '../audit-trail/audit-appender.repository.js';
import { WorkspaceAuditTrailRepository } from '../audit-trail/audit-trail.repository.js';
import { createCanonicalJsonDigest } from '../recording/canonical-json.js';
import { WorkflowLocatorRepairRepositoryError } from './workflow-locator-repair-errors.js';
import type {
  WorkflowLocatorRepairAccess,
  WorkflowLocatorRepairCandidateRecord,
  WorkflowLocatorRepairProposalRecord,
} from './workflow-locator-repair-records.js';

const LOCATOR_REPAIR_NAMESPACES = {
  proposalCreated: 'locator_repair_proposal_created',
  candidateTested: 'locator_repair_candidate_tested',
  applied: 'locator_repair_applied',
  dismissed: 'locator_repair_dismissed',
} as const;

function buildLocatorRepairProposalCreatedInput(input: {
  workspaceId: string;
  actor: { type: 'runner'; runnerDeviceId: string };
  proposalId: string;
  workflowRunId: string;
  stepId: string;
  stepIndex: number;
  failedAttemptNumber: number;
  candidateCount: number;
  occurredAt: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'locator_repair.proposal_created',
    actor: input.actor,
    primaryEntity: {
      kind: 'locator_repair_proposal',
      id: input.proposalId,
    },
    relatedEntities: [{ kind: 'workflow_run', id: input.workflowRunId }],
    occurredAt: input.occurredAt,
    sourceId: createAuditSourceId(
      LOCATOR_REPAIR_NAMESPACES.proposalCreated,
      [input.proposalId],
      auditHasherForTrail,
    ),
    payload: {
      proposalId: input.proposalId,
      workflowRunId: input.workflowRunId,
      stepId: input.stepId,
      stepIndex: input.stepIndex,
      failedAttemptNumber: input.failedAttemptNumber,
      candidateCount: input.candidateCount,
    },
  };
}

function buildLocatorRepairCandidateTestedInput(input: {
  workspaceId: string;
  actor: { type: 'runner'; runnerDeviceId: string };
  proposalId: string;
  candidateId: string;
  candidateRank: number;
  candidateStrategy: string;
  candidateConfidence: 'low' | 'medium' | 'high';
  testStatus:
    | 'pending'
    | 'passed'
    | 'not_found'
    | 'not_unique'
    | 'not_actionable'
    | 'incompatible_element'
    | 'stale_page_context'
    | 'cancelled'
    | 'error';
  evidenceCodeCount: number;
  testedAt?: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'locator_repair.candidate_tested',
    actor: input.actor,
    primaryEntity: {
      kind: 'locator_repair_candidate',
      id: input.candidateId,
    },
    relatedEntities: [
      { kind: 'locator_repair_proposal', id: input.proposalId },
    ],
    occurredAt: input.testedAt ?? new Date(),
    sourceId: createAuditSourceId(
      LOCATOR_REPAIR_NAMESPACES.candidateTested,
      [input.candidateId, input.testStatus, input.testedAt?.toISOString() ?? ''],
      auditHasherForTrail,
    ),
    payload: {
      proposalId: input.proposalId,
      candidateId: input.candidateId,
      candidateRank: input.candidateRank,
      candidateStrategy: input.candidateStrategy,
      candidateConfidence: input.candidateConfidence,
      testStatus: input.testStatus,
      evidenceCodeCount: input.evidenceCodeCount,
      ...(input.testedAt === undefined
        ? {}
        : { testedAt: input.testedAt.toISOString() }),
    },
  };
}

function buildLocatorRepairAppliedInput(input: {
  workspaceId: string;
  actor: { type: 'user'; userId: string };
  proposalId: string;
  candidateId: string;
  workflowRunId: string;
  stepId: string;
  stepIndex: number;
  targetDraftVersionId: string;
  previousRevision: number;
  newRevision: number;
  appliedAt: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'locator_repair.applied_to_draft',
    actor: input.actor,
    primaryEntity: {
      kind: 'locator_repair_proposal',
      id: input.proposalId,
    },
    relatedEntities: [{ kind: 'workflow_run', id: input.workflowRunId }],
    occurredAt: input.appliedAt,
    sourceId: createAuditSourceId(
      LOCATOR_REPAIR_NAMESPACES.applied,
      [input.proposalId, input.appliedAt.toISOString()],
      auditHasherForTrail,
    ),
    payload: {
      proposalId: input.proposalId,
      candidateId: input.candidateId,
      workflowRunId: input.workflowRunId,
      stepId: input.stepId,
      stepIndex: input.stepIndex,
      targetDraftVersionId: input.targetDraftVersionId,
      previousRevision: input.previousRevision,
      newRevision: input.newRevision,
      appliedAt: input.appliedAt.toISOString(),
    },
  };
}

function buildLocatorRepairDismissedInput(input: {
  workspaceId: string;
  actor: { type: 'system'; reason: 'automatic_expiry' };
  proposalId: string;
  workflowRunId: string;
  reason: 'expired' | 'invalidated';
  dismissedAt: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'locator_repair.dismissed',
    actor: input.actor,
    primaryEntity: {
      kind: 'locator_repair_proposal',
      id: input.proposalId,
    },
    relatedEntities: [{ kind: 'workflow_run', id: input.workflowRunId }],
    occurredAt: input.dismissedAt,
    sourceId: createAuditSourceId(
      LOCATOR_REPAIR_NAMESPACES.dismissed,
      [input.proposalId, input.reason, input.dismissedAt.toISOString()],
      auditHasherForTrail,
    ),
    payload: {
      proposalId: input.proposalId,
      workflowRunId: input.workflowRunId,
      reason: input.reason,
      dismissedAt: input.dismissedAt.toISOString(),
    },
  };
}

const WRITERS = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
  OrganizationRole.MEMBER,
] as const;
const MAX_SERIALIZATION_ATTEMPTS = 3;

const proposalInclude = {
  candidates: { orderBy: { rank: 'asc' as const } },
  workflowRun: {
    include: {
      workflow: { select: { name: true } },
      workflowVersion: { select: { version: true, definition: true } },
    },
  },
} as const satisfies Prisma.WorkflowLocatorRepairProposalInclude;

type ProposalRow = Prisma.WorkflowLocatorRepairProposalGetPayload<{
  include: typeof proposalInclude;
}>;

function jsonStringArray(value: Prisma.JsonValue | null): string[] {
  if (value === null || !Array.isArray(value)) return [];
  if (!value.every((item) => typeof item === 'string')) {
    throw new WorkflowLocatorRepairRepositoryError('LOCATOR_REPAIR_INVALID');
  }
  return value;
}

function toCandidateRecord(
  row: ProposalRow['candidates'][number],
): WorkflowLocatorRepairCandidateRecord {
  const status = LocatorRepairCandidateTestStatusSchema.parse(row.testStatus);
  const evidenceCodes = z
    .array(LocatorRepairEvidenceCodeSchema)
    .parse(jsonStringArray(row.evidenceCodes));
  return {
    id: row.id,
    clientCandidateId: row.clientCandidateId,
    locator: ElementLocatorSchema.parse(row.locator),
    locatorDigest: row.locatorDigest,
    rank: row.rank,
    strategy: row.strategy,
    confidence: z.enum(['high', 'medium', 'low']).parse(row.confidence),
    score: row.score,
    elementKind: z
      .enum([
        'button',
        'link',
        'text_input',
        'select',
        'checkbox',
        'radio',
        'generic',
      ])
      .parse(row.elementKind),
    reasonCodes: jsonStringArray(row.reasonCodes),
    evidenceCodes,
    privacyClassification: row.privacyClassification,
    privacyRuleIds: jsonStringArray(row.privacyRuleIds),
    testStatus: status,
    clientTestRequestId: row.clientTestRequestId,
    testRequestedAt: row.testRequestedAt,
    clientTestResultId: row.clientTestResultId,
    testObservations: jsonStringArray(row.testObservations),
    testedAt: row.testedAt,
  };
}

function toProposalRecord(
  row: ProposalRow,
): WorkflowLocatorRepairProposalRecord {
  const workflow = WorkflowDefinitionSchema.parse(
    row.workflowRun.workflowVersion.definition,
  );
  const step = workflow.steps[row.stepIndex];
  if (step === undefined || step.id !== row.stepId) {
    throw new WorkflowLocatorRepairRepositoryError('LOCATOR_REPAIR_INVALID');
  }
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    workflowRunId: row.workflowRunId,
    workflowId: row.workflowRun.workflowId,
    workflowName: row.workflowRun.workflow.name,
    sourceWorkflowVersionId: row.sourceWorkflowVersionId,
    sourceWorkflowVersion: row.workflowRun.workflowVersion.version,
    runnerDeviceId: row.runnerDeviceId,
    workflowRepairRequestId: row.workflowRepairRequestId,
    step: {
      id: step.id,
      index: row.stepIndex,
      name: step.name,
      type: step.type,
    },
    failedAttemptNumber: row.failedAttemptNumber,
    sourceStepDigest: row.sourceStepDigest,
    sourceLocatorDigest: row.sourceLocatorDigest,
    pageContextDigest: row.pageContextDigest,
    status: row.status,
    selectedCandidateId: row.selectedCandidateId,
    appliedDraftVersionId: row.appliedDraftVersionId,
    appliedDraftRevision: row.appliedDraftRevision,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    candidates: row.candidates.map(toCandidateRecord),
  };
}

function effectFromDatabase(value: string) {
  return z
    .enum([
      'not_started',
      'read_only',
      'side_effect_possible',
      'completed',
      'unknown',
    ])
    .parse(value.toLowerCase());
}

function locatorValue(locator: ElementLocator): string {
  switch (locator.kind) {
    case 'role':
      return locator.name ?? locator.role;
    case 'css':
      return locator.selector;
    default:
      return locator.value;
  }
}

function testRequirement(step: WorkflowStep) {
  switch (step.type) {
    case 'click':
      return 'click_actionable' as const;
    case 'fill':
      return 'fill_editable' as const;
    case 'select':
      return 'select_actionable' as const;
    case 'setChecked':
      return 'checked_actionable' as const;
    case 'verify':
      return 'verify_readable' as const;
    case 'extract':
      return 'extract_readable' as const;
    default:
      throw new WorkflowLocatorRepairRepositoryError(
        'LOCATOR_REPAIR_NOT_ELIGIBLE',
      );
  }
}

interface Binding {
  workflow: ReturnType<typeof WorkflowDefinitionSchema.parse>;
  step: WorkflowStep;
  stepIndex: number;
  locator: ElementLocator;
  sourceStepDigest: string;
  sourceLocatorDigest: string;
  recordedFallbacks: ElementLocator[];
}

function deriveBinding(input: {
  definition: Prisma.JsonValue;
  conversionReport: Prisma.JsonValue | null;
  stepId: string;
  stepIndex: number;
  safeErrorCode: string;
  effectCertainty: string;
  approvalGated?: boolean;
}): Binding {
  const workflow = WorkflowDefinitionSchema.parse(input.definition);
  const step = workflow.steps[input.stepIndex];
  if (step === undefined || step.id !== input.stepId) {
    throw new WorkflowLocatorRepairRepositoryError('LOCATOR_REPAIR_INVALID');
  }
  const eligibility = assessLocatorRepairEligibility({
    step,
    errorCode: input.safeErrorCode,
    effectCertainty: effectFromDatabase(input.effectCertainty),
    approvalGated:
      input.approvalGated ?? isApprovalGatedStep(workflow, step.id),
  });
  if (!eligibility.eligible) {
    throw new WorkflowLocatorRepairRepositoryError(
      'LOCATOR_REPAIR_NOT_ELIGIBLE',
    );
  }
  const report = RecordingConversionReportSchema.safeParse(
    input.conversionReport,
  );
  const mapping = report.success
    ? report.data.mappings.find(
        (item) => item.outcome === 'converted' && item.stepId === step.id,
      )
    : undefined;
  const recordedFallbacks =
    mapping?.outcome === 'converted'
      ? mapping.locatorBundle.fallbacks
          .map((candidate) => candidate.locator)
          .filter(
            (locator) =>
              canonicalizeLocator(locator) !==
              canonicalizeLocator(eligibility.locator),
          )
          .slice(0, 4)
      : [];
  return {
    workflow,
    step,
    stepIndex: input.stepIndex,
    locator: eligibility.locator,
    sourceStepDigest: createCanonicalJsonDigest(step),
    sourceLocatorDigest: createCanonicalJsonDigest(eligibility.locator),
    recordedFallbacks,
  };
}

export class WorkflowLocatorRepairRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditTrail: WorkspaceAuditTrailRepository = new WorkspaceAuditTrailRepository(
      prisma,
    ),
  ) {}

  async resolveProposalAccess(
    userId: string,
    proposalId: string,
  ): Promise<WorkflowLocatorRepairAccess | null> {
    const row = await this.prisma.workflowLocatorRepairProposal.findFirst({
      where: {
        id: proposalId,
        workspace: { organization: { members: { some: { userId } } } },
      },
      select: {
        workspaceId: true,
        workspace: {
          select: {
            organization: {
              select: {
                id: true,
                members: {
                  where: { userId },
                  select: { role: true },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });
    const member = row?.workspace.organization.members[0];
    return row === null || row === undefined || member === undefined
      ? null
      : {
          userId,
          organizationId: row.workspace.organization.id,
          workspaceId: row.workspaceId,
          role: member.role,
        };
  }

  async discoverySeedForRunner(input: {
    workflowRunId: string;
    repairRequestId: string;
    runnerDeviceId: string;
    leaseTokenHash: string;
    now: Date;
  }): Promise<LocatorRepairDiscoverySeed> {
    const repair = await this.prisma.workflowRepairRequest.findFirst({
      where: {
        id: input.repairRequestId,
        workflowRunId: input.workflowRunId,
        runnerDeviceId: input.runnerDeviceId,
        status: WorkflowRepairRequestStatus.PENDING,
        expiresAt: { gt: input.now },
        workflowRun: {
          runnerDeviceId: input.runnerDeviceId,
          leaseTokenHash: input.leaseTokenHash,
          leaseExpiresAt: { gt: input.now },
          status: WorkflowRunStatus.WAITING_FOR_REPAIR,
        },
      },
      include: {
        workflowRun: {
          include: {
            workflowVersion: {
              include: {
                recordingConversion: {
                  select: { conversionReport: true },
                },
              },
            },
          },
        },
      },
    });
    if (repair === null) {
      throw new WorkflowLocatorRepairRepositoryError(
        'LOCATOR_REPAIR_NOT_FOUND',
      );
    }
    const binding = deriveBinding({
      definition: repair.workflowRun.workflowVersion.definition,
      conversionReport:
        repair.workflowRun.workflowVersion.recordingConversion
          ?.conversionReport ?? null,
      stepId: repair.stepId,
      stepIndex: repair.stepIndex,
      safeErrorCode: repair.safeErrorCode,
      effectCertainty: repair.effectCertainty,
    });
    return LocatorRepairDiscoverySeedSchema.parse({
      schemaVersion: 1,
      repairRequestId: repair.id,
      sourceStepDigest: binding.sourceStepDigest,
      sourceLocatorDigest: binding.sourceLocatorDigest,
      step: binding.step,
      sourceLocator: binding.locator,
      recordedFallbacks: binding.recordedFallbacks,
    });
  }

  async createForRunner(input: {
    workflowRunId: string;
    runnerDeviceId: string;
    leaseTokenHash: string;
    request: RunnerLocatorRepairProposalCreate;
    now: Date;
  }): Promise<{
    idempotent: boolean;
    record: WorkflowLocatorRepairProposalRecord;
  }> {
    const request = RunnerLocatorRepairProposalCreateSchema.parse(
      input.request,
    );
    return this.runSerializable(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM "workflow_runs" WHERE id = ${input.workflowRunId}::uuid FOR UPDATE`;
      const repair = await transaction.workflowRepairRequest.findFirst({
        where: {
          id: request.repairRequestId,
          workflowRunId: input.workflowRunId,
        },
        include: {
          workflowRun: {
            include: {
              workflowVersion: {
                include: {
                  recordingConversion: {
                    select: { conversionReport: true },
                  },
                },
              },
            },
          },
        },
      });
      if (repair === null) {
        throw new WorkflowLocatorRepairRepositoryError(
          'LOCATOR_REPAIR_NOT_FOUND',
        );
      }
      const run = repair.workflowRun;
      if (
        run.runnerDeviceId !== input.runnerDeviceId ||
        repair.runnerDeviceId !== input.runnerDeviceId
      ) {
        throw new WorkflowLocatorRepairRepositoryError('RUNNER_MISMATCH');
      }
      if (
        run.leaseTokenHash !== input.leaseTokenHash ||
        run.leaseExpiresAt === null ||
        run.leaseExpiresAt <= input.now
      ) {
        throw new WorkflowLocatorRepairRepositoryError('LEASE_INVALID');
      }
      if (
        run.status !== WorkflowRunStatus.WAITING_FOR_REPAIR ||
        repair.status !== WorkflowRepairRequestStatus.PENDING ||
        repair.expiresAt <= input.now ||
        repair.retryAllowed
      ) {
        throw new WorkflowLocatorRepairRepositoryError(
          'LOCATOR_REPAIR_CONFLICT',
        );
      }
      const binding = deriveBinding({
        definition: run.workflowVersion.definition,
        conversionReport:
          run.workflowVersion.recordingConversion?.conversionReport ?? null,
        stepId: repair.stepId,
        stepIndex: repair.stepIndex,
        safeErrorCode: repair.safeErrorCode,
        effectCertainty: repair.effectCertainty,
      });
      const requestDigest = createCanonicalJsonDigest(request);
      const existing =
        await transaction.workflowLocatorRepairProposal.findFirst({
          where: {
            workflowRunId: run.id,
            OR: [
              { clientProposalId: request.clientProposalId },
              { workflowRepairRequestId: repair.id },
            ],
          },
          include: proposalInclude,
        });
      if (existing !== null) {
        if (
          existing.clientProposalId !== request.clientProposalId ||
          existing.requestDigest !== requestDigest
        ) {
          throw new WorkflowLocatorRepairRepositoryError(
            'LOCATOR_REPAIR_CONFLICT',
          );
        }
        return { idempotent: true, record: toProposalRecord(existing) };
      }
      const observations = request.candidates.map((candidate) => {
        if (
          !isLocatorCandidatePrivacyEligible({
            locator: candidate.locator,
            privacyInput: candidate.privacyInput,
            privacyDecision: candidate.privacyDecision,
          }) ||
          !isLocatorCompatibleWithStep(binding.step, candidate.elementKind)
        ) {
          throw new WorkflowLocatorRepairRepositoryError(
            'LOCATOR_REPAIR_INVALID',
          );
        }
        const observation = LocatorObservationSchema.parse({
          locator: candidate.locator,
          source: candidate.source,
          matchCount: 1,
          stabilityValue: locatorValue(candidate.locator),
        });
        const scored = scoreLocatorObservation(observation);
        if (
          scored === null ||
          scored.candidate.score !== candidate.score ||
          scored.candidate.reasons.map((item) => item.code).join('\0') !==
            candidate.reasonCodes.join('\0')
        ) {
          throw new WorkflowLocatorRepairRepositoryError(
            'LOCATOR_REPAIR_INVALID',
          );
        }
        return observation;
      });
      const ranked = rankLocatorBundle(observations, request.generatedAt);
      const serverCandidates = ranked.success
        ? [ranked.bundle.primary, ...ranked.bundle.fallbacks]
        : [];
      if (
        serverCandidates.length !== request.candidates.length ||
        serverCandidates.some(
          (candidate, index) =>
            canonicalizeLocator(candidate.locator) !==
              canonicalizeLocator(request.candidates[index]!.locator) ||
            calculateLocatorConfidence(
              candidate,
              serverCandidates.slice(index + 1),
            ) !== request.candidates[index]!.confidence,
        )
      ) {
        throw new WorkflowLocatorRepairRepositoryError(
          'LOCATOR_REPAIR_INVALID',
        );
      }
      const locatorDigests = request.candidates.map((candidate) =>
        createCanonicalJsonDigest(candidate.locator),
      );
      if (new Set(locatorDigests).size !== locatorDigests.length) {
        throw new WorkflowLocatorRepairRepositoryError(
          'LOCATOR_REPAIR_INVALID',
        );
      }
      const created = await transaction.workflowLocatorRepairProposal.create({
        data: {
          workspaceId: run.workspaceId,
          workflowRunId: run.id,
          sourceWorkflowVersionId: run.workflowVersionId,
          runnerDeviceId: input.runnerDeviceId,
          workflowRepairRequestId: repair.id,
          stepId: binding.step.id,
          stepIndex: binding.stepIndex,
          failedAttemptNumber: repair.attemptNumber,
          clientProposalId: request.clientProposalId,
          requestDigest,
          sourceStepDigest: binding.sourceStepDigest,
          sourceLocatorDigest: binding.sourceLocatorDigest,
          pageContextDigest: request.pageContextDigest,
          expiresAt: repair.expiresAt,
          candidates: {
            create: request.candidates.map((candidate, index) => ({
              clientCandidateId: candidate.clientCandidateId,
              locator: candidate.locator as Prisma.InputJsonValue,
              locatorDigest: locatorDigests[index]!,
              rank: index + 1,
              strategy: candidate.source,
              confidence: candidate.confidence,
              score: candidate.score,
              elementKind: candidate.elementKind,
              reasonCodes: candidate.reasonCodes,
              evidenceCodes: candidate.evidenceCodes,
              privacyClassification: candidate.privacyDecision.sensitivity,
              privacyRuleIds: candidate.privacyDecision.matchedRules,
            })),
          },
        },
        include: proposalInclude,
      });
      await appendAuditEventTransactional(
        transaction,
        this.auditTrail,
        buildLocatorRepairProposalCreatedInput({
          workspaceId: run.workspaceId,
          actor: {
            type: 'runner',
            runnerDeviceId: input.runnerDeviceId,
          },
          proposalId: created.id,
          workflowRunId: run.id,
          stepId: binding.step.id,
          stepIndex: binding.stepIndex,
          failedAttemptNumber: repair.attemptNumber,
          candidateCount: request.candidates.length,
          occurredAt: input.now,
        }),
      );
      return { idempotent: false, record: toProposalRecord(created) };
    });
  }

  async requestCandidateTest(input: {
    userId: string;
    candidateId: string;
    request: unknown;
    now: Date;
  }): Promise<{
    idempotent: boolean;
    record: WorkflowLocatorRepairProposalRecord;
  }> {
    const request = LocatorRepairCandidateTestRequestSchema.parse(
      input.request,
    );
    return this.runSerializable(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM "workflow_locator_repair_candidates" WHERE id = ${input.candidateId}::uuid FOR UPDATE`;
      const candidate =
        await transaction.workflowLocatorRepairCandidate.findUnique({
          where: { id: input.candidateId },
          include: {
            proposal: {
              include: {
                workspace: {
                  select: {
                    organization: {
                      select: {
                        members: {
                          where: { userId: input.userId },
                          select: { role: true },
                          take: 1,
                        },
                      },
                    },
                  },
                },
                workflowRun: {
                  select: {
                    status: true,
                    leaseExpiresAt: true,
                    runnerDevice: { select: { revokedAt: true } },
                  },
                },
                workflowRepairRequest: { select: { status: true } },
              },
            },
          },
        });
      const role = candidate?.proposal.workspace.organization.members[0]?.role;
      if (candidate === null || candidate === undefined || role === undefined) {
        throw new WorkflowLocatorRepairRepositoryError(
          'LOCATOR_REPAIR_NOT_FOUND',
        );
      }
      if (!WRITERS.includes(role as (typeof WRITERS)[number])) {
        throw new WorkflowLocatorRepairRepositoryError(
          'LOCATOR_REPAIR_FORBIDDEN',
        );
      }
      const digest = createCanonicalJsonDigest(request);
      if (candidate.clientTestRequestId === request.clientTestRequestId) {
        if (candidate.testRequestDigest !== digest) {
          throw new WorkflowLocatorRepairRepositoryError(
            'LOCATOR_REPAIR_CONFLICT',
          );
        }
        const proposal =
          await transaction.workflowLocatorRepairProposal.findUniqueOrThrow({
            where: { id: candidate.proposalId },
            include: proposalInclude,
          });
        return { idempotent: true, record: toProposalRecord(proposal) };
      }
      if (
        candidate.testStatus !==
          WorkflowLocatorRepairCandidateTestStatus.NOT_REQUESTED ||
        (candidate.proposal.status !==
          WorkflowLocatorRepairProposalStatus.OPEN &&
          candidate.proposal.status !==
            WorkflowLocatorRepairProposalStatus.READY) ||
        candidate.proposal.expiresAt <= input.now ||
        candidate.proposal.workflowRun.status !==
          WorkflowRunStatus.WAITING_FOR_REPAIR ||
        candidate.proposal.workflowRun.leaseExpiresAt === null ||
        candidate.proposal.workflowRun.leaseExpiresAt <= input.now ||
        candidate.proposal.workflowRun.runnerDevice.revokedAt !== null ||
        candidate.proposal.workflowRepairRequest.status !==
          WorkflowRepairRequestStatus.PENDING
      ) {
        throw new WorkflowLocatorRepairRepositoryError(
          'LOCATOR_REPAIR_CONFLICT',
        );
      }
      const pending =
        await transaction.workflowLocatorRepairCandidate.findFirst({
          where: {
            proposalId: candidate.proposalId,
            testStatus: WorkflowLocatorRepairCandidateTestStatus.PENDING,
          },
          select: { id: true },
        });
      if (pending !== null) {
        throw new WorkflowLocatorRepairRepositoryError(
          'LOCATOR_REPAIR_CONFLICT',
        );
      }
      await transaction.workflowLocatorRepairCandidate.update({
        where: { id: candidate.id },
        data: {
          testStatus: WorkflowLocatorRepairCandidateTestStatus.PENDING,
          clientTestRequestId: request.clientTestRequestId,
          testRequestDigest: digest,
          testRequestedByUserId: input.userId,
          testRequestedAt: input.now,
        },
      });
      const proposal =
        await transaction.workflowLocatorRepairProposal.findUniqueOrThrow({
          where: { id: candidate.proposalId },
          include: proposalInclude,
        });
      return { idempotent: false, record: toProposalRecord(proposal) };
    });
  }

  async pollForRunner(input: {
    workflowRunId: string;
    runnerDeviceId: string;
    leaseTokenHash: string;
    now: Date;
  }): Promise<{
    record: WorkflowLocatorRepairProposalRecord;
    command: {
      candidateId: string;
      proposalId: string;
      pageContextDigest: string;
      locator: ElementLocator;
      elementKind: WorkflowLocatorRepairCandidateRecord['elementKind'];
      requirement: ReturnType<typeof testRequirement>;
    } | null;
  }> {
    const proposal = await this.prisma.workflowLocatorRepairProposal.findFirst({
      where: {
        workflowRunId: input.workflowRunId,
        runnerDeviceId: input.runnerDeviceId,
        status: {
          in: [
            WorkflowLocatorRepairProposalStatus.OPEN,
            WorkflowLocatorRepairProposalStatus.READY,
          ],
        },
        expiresAt: { gt: input.now },
        workflowRun: {
          runnerDeviceId: input.runnerDeviceId,
          leaseTokenHash: input.leaseTokenHash,
          leaseExpiresAt: { gt: input.now },
          status: WorkflowRunStatus.WAITING_FOR_REPAIR,
        },
      },
      include: proposalInclude,
    });
    if (proposal === null) {
      throw new WorkflowLocatorRepairRepositoryError(
        'LOCATOR_REPAIR_NOT_FOUND',
      );
    }
    const record = toProposalRecord(proposal);
    const step = WorkflowDefinitionSchema.parse(
      proposal.workflowRun.workflowVersion.definition,
    ).steps[proposal.stepIndex];
    if (step === undefined || step.id !== proposal.stepId) {
      throw new WorkflowLocatorRepairRepositoryError('LOCATOR_REPAIR_INVALID');
    }
    const pending = record.candidates.find(
      (candidate) => candidate.testStatus === 'PENDING',
    );
    return {
      record,
      command:
        pending === undefined
          ? null
          : {
              candidateId: pending.id,
              proposalId: record.id,
              pageContextDigest: record.pageContextDigest,
              locator: pending.locator,
              elementKind: pending.elementKind,
              requirement: testRequirement(step),
            },
    };
  }

  async submitTestResultForRunner(input: {
    workflowRunId: string;
    candidateId: string;
    runnerDeviceId: string;
    leaseTokenHash: string;
    result: RunnerLocatorRepairCandidateTestResult;
    now: Date;
  }): Promise<{
    idempotent: boolean;
    record: WorkflowLocatorRepairProposalRecord;
  }> {
    const result = RunnerLocatorRepairCandidateTestResultSchema.parse(
      input.result,
    );
    return this.runSerializable(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM "workflow_locator_repair_candidates" WHERE id = ${input.candidateId}::uuid FOR UPDATE`;
      const candidate =
        await transaction.workflowLocatorRepairCandidate.findUnique({
          where: { id: input.candidateId },
          include: {
            proposal: {
              include: {
                workflowRun: true,
              },
            },
          },
        });
      if (
        candidate === null ||
        candidate.proposal.workflowRunId !== input.workflowRunId
      ) {
        throw new WorkflowLocatorRepairRepositoryError(
          'LOCATOR_REPAIR_NOT_FOUND',
        );
      }
      const run = candidate.proposal.workflowRun;
      if (run.runnerDeviceId !== input.runnerDeviceId) {
        throw new WorkflowLocatorRepairRepositoryError('RUNNER_MISMATCH');
      }
      if (
        run.leaseTokenHash !== input.leaseTokenHash ||
        run.leaseExpiresAt === null ||
        run.leaseExpiresAt <= input.now
      ) {
        throw new WorkflowLocatorRepairRepositoryError('LEASE_INVALID');
      }
      const digest = createCanonicalJsonDigest(result);
      if (candidate.clientTestResultId === result.clientTestResultId) {
        if (candidate.testResultDigest !== digest) {
          throw new WorkflowLocatorRepairRepositoryError(
            'LOCATOR_REPAIR_CONFLICT',
          );
        }
        const proposal =
          await transaction.workflowLocatorRepairProposal.findUniqueOrThrow({
            where: { id: candidate.proposalId },
            include: proposalInclude,
          });
        return { idempotent: true, record: toProposalRecord(proposal) };
      }
      if (
        candidate.testStatus !==
          WorkflowLocatorRepairCandidateTestStatus.PENDING ||
        candidate.proposal.expiresAt <= input.now ||
        (result.pageContextDigest !== candidate.proposal.pageContextDigest &&
          result.status !== 'STALE_PAGE_CONTEXT')
      ) {
        throw new WorkflowLocatorRepairRepositoryError(
          'LOCATOR_REPAIR_CONFLICT',
        );
      }
      await transaction.workflowLocatorRepairCandidate.update({
        where: { id: candidate.id },
        data: {
          testStatus: result.status,
          clientTestResultId: result.clientTestResultId,
          testResultDigest: digest,
          testObservations: result.observations,
          testedAt: input.now,
        },
      });
      await appendAuditEventTransactional(
        transaction,
        this.auditTrail,
        buildLocatorRepairCandidateTestedInput({
          workspaceId: candidate.proposal.workspaceId,
          actor: {
            type: 'runner',
            runnerDeviceId: input.runnerDeviceId,
          },
          proposalId: candidate.proposalId,
          candidateId: candidate.id,
          candidateRank: candidate.rank,
          candidateStrategy: candidate.strategy,
          candidateConfidence: candidate.confidence as 'low' | 'medium' | 'high',
          testStatus: result.status.toLowerCase() as
            | 'pending'
            | 'passed'
            | 'not_found'
            | 'not_unique'
            | 'not_actionable'
            | 'incompatible_element'
            | 'stale_page_context'
            | 'cancelled'
            | 'error',
          evidenceCodeCount: jsonStringArray(candidate.evidenceCodes).length,
          testedAt: input.now,
        }),
      );
      if (result.status === 'PASSED') {
        await transaction.workflowLocatorRepairProposal.updateMany({
          where: {
            id: candidate.proposalId,
            status: WorkflowLocatorRepairProposalStatus.OPEN,
          },
          data: { status: WorkflowLocatorRepairProposalStatus.READY },
        });
      }
      const proposal =
        await transaction.workflowLocatorRepairProposal.findUniqueOrThrow({
          where: { id: candidate.proposalId },
          include: proposalInclude,
        });
      return { idempotent: false, record: toProposalRecord(proposal) };
    });
  }

  async listForWorkspace(userId: string, workspaceId: string) {
    const access = await this.workspaceAccess(userId, workspaceId);
    const rows = await this.prisma.workflowLocatorRepairProposal.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 1000,
      include: proposalInclude,
    });
    return { access, records: rows.map(toProposalRecord) };
  }

  async getForUser(userId: string, proposalId: string) {
    const access = await this.resolveProposalAccess(userId, proposalId);
    if (access === null) {
      throw new WorkflowLocatorRepairRepositoryError(
        'LOCATOR_REPAIR_NOT_FOUND',
      );
    }
    const row = await this.prisma.workflowLocatorRepairProposal.findUnique({
      where: { id: proposalId },
      include: proposalInclude,
    });
    if (row === null) {
      throw new WorkflowLocatorRepairRepositoryError(
        'LOCATOR_REPAIR_NOT_FOUND',
      );
    }
    return { access, record: toProposalRecord(row) };
  }

  async applyToDraft(input: {
    userId: string;
    proposalId: string;
    request: ApplyLocatorRepairToDraftRequest;
    now: Date;
  }): Promise<{
    idempotent: boolean;
    proposalId: string;
    targetDraftVersionId: string;
    revision: number;
  }> {
    const request = ApplyLocatorRepairToDraftRequestSchema.parse(input.request);
    const digest = createCanonicalJsonDigest(request);
    return this.runSerializable(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM "workflow_locator_repair_proposals" WHERE id = ${input.proposalId}::uuid FOR UPDATE`;
      await transaction.$queryRaw`SELECT id FROM "workflow_versions" WHERE id = ${request.targetDraftVersionId}::uuid FOR UPDATE`;
      const proposal =
        await transaction.workflowLocatorRepairProposal.findUnique({
          where: { id: input.proposalId },
          include: {
            candidates: true,
            workflowRun: {
              include: {
                workflowVersion: true,
                workspace: {
                  select: {
                    organization: {
                      select: {
                        members: {
                          where: { userId: input.userId },
                          select: { role: true },
                          take: 1,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        });
      if (proposal === null) {
        throw new WorkflowLocatorRepairRepositoryError(
          'LOCATOR_REPAIR_NOT_FOUND',
        );
      }
      const role = proposal.workflowRun.workspace.organization.members[0]?.role;
      if (role === undefined) {
        throw new WorkflowLocatorRepairRepositoryError(
          'LOCATOR_REPAIR_NOT_FOUND',
        );
      }
      if (!WRITERS.includes(role as (typeof WRITERS)[number])) {
        throw new WorkflowLocatorRepairRepositoryError(
          'LOCATOR_REPAIR_FORBIDDEN',
        );
      }
      if (proposal.clientApplyId === request.clientApplyId) {
        if (
          proposal.applyDigest !== digest ||
          proposal.appliedDraftVersionId !== request.targetDraftVersionId ||
          proposal.appliedDraftRevision === null
        ) {
          throw new WorkflowLocatorRepairRepositoryError(
            'LOCATOR_REPAIR_CONFLICT',
          );
        }
        return {
          idempotent: true,
          proposalId: proposal.id,
          targetDraftVersionId:
            proposal.appliedDraftVersionId ?? request.targetDraftVersionId,
          revision: proposal.appliedDraftRevision,
        };
      }
      if (
        proposal.status !== WorkflowLocatorRepairProposalStatus.READY ||
        proposal.expiresAt <= input.now
      ) {
        throw new WorkflowLocatorRepairRepositoryError(
          proposal.expiresAt <= input.now
            ? 'LOCATOR_REPAIR_EXPIRED'
            : 'LOCATOR_REPAIR_CONFLICT',
        );
      }
      const candidate = proposal.candidates.find(
        (item) => item.id === request.candidateId,
      );
      if (
        candidate === undefined ||
        candidate.testStatus !== WorkflowLocatorRepairCandidateTestStatus.PASSED
      ) {
        throw new WorkflowLocatorRepairRepositoryError(
          'LOCATOR_REPAIR_CANDIDATE_NOT_TESTED',
        );
      }
      const target = await transaction.workflowVersion.findUnique({
        where: { id: request.targetDraftVersionId },
      });
      if (
        target === null ||
        target.workflowId !== proposal.workflowRun.workflowId
      ) {
        throw new WorkflowLocatorRepairRepositoryError(
          'LOCATOR_REPAIR_LINEAGE_MISMATCH',
        );
      }
      if (target.status !== 'draft') {
        throw new WorkflowLocatorRepairRepositoryError(
          'LOCATOR_REPAIR_DRAFT_REQUIRED',
        );
      }
      if (target.revision !== request.expectedRevision) {
        throw new WorkflowLocatorRepairRepositoryError(
          'LOCATOR_REPAIR_REVISION_CONFLICT',
          target.revision,
        );
      }
      if (
        !(await this.hasCompatibleLineage(
          transaction,
          target.createdFromVersionId,
          proposal.sourceWorkflowVersionId,
          target.workflowId,
        ))
      ) {
        throw new WorkflowLocatorRepairRepositoryError(
          'LOCATOR_REPAIR_LINEAGE_MISMATCH',
        );
      }
      const targetWorkflow = WorkflowDefinitionSchema.parse(target.definition);
      const targetStep = targetWorkflow.steps.find(
        (step) => step.id === proposal.stepId,
      );
      const targetLocator =
        targetStep === undefined ? null : locatorForWorkflowStep(targetStep);
      if (
        targetLocator === null ||
        createCanonicalJsonDigest(targetLocator) !==
          proposal.sourceLocatorDigest
      ) {
        throw new WorkflowLocatorRepairRepositoryError(
          'LOCATOR_REPAIR_LOCATOR_CHANGED',
        );
      }
      const patched = replaceWorkflowStepLocator(
        targetWorkflow,
        proposal.stepId,
        ElementLocatorSchema.parse(candidate.locator),
      );
      if (!patched.ok || validateEditorWorkflow(patched.workflow).length > 0) {
        throw new WorkflowLocatorRepairRepositoryError(
          'LOCATOR_REPAIR_INVALID',
        );
      }
      const activePolicy =
        await transaction.workspaceExecutionPolicyVersion.findFirst({
          where: { workspaceId: proposal.workspaceId, status: 'ACTIVE' },
          select: { definition: true },
        });
      const policy = WorkspaceExecutionPolicyDefinitionSchema.safeParse(
        activePolicy?.definition,
      );
      if (
        !policy.success ||
        !analyzePublishReadiness(patched.workflow, policy.data).ready
      ) {
        throw new WorkflowLocatorRepairRepositoryError(
          'LOCATOR_REPAIR_INVALID',
        );
      }
      const updated = await transaction.workflowVersion.updateMany({
        where: {
          id: target.id,
          status: 'draft',
          revision: request.expectedRevision,
        },
        data: {
          definition: patched.workflow as Prisma.InputJsonValue,
          revision: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        const latest = await transaction.workflowVersion.findUnique({
          where: { id: target.id },
          select: { revision: true },
        });
        throw new WorkflowLocatorRepairRepositoryError(
          'LOCATOR_REPAIR_REVISION_CONFLICT',
          latest?.revision,
        );
      }
      const revision = request.expectedRevision + 1;
      await transaction.workflowLocatorRepairProposal.update({
        where: { id: proposal.id },
        data: {
          status: WorkflowLocatorRepairProposalStatus.APPLIED,
          selectedCandidateId: candidate.id,
          appliedDraftVersionId: target.id,
          appliedDraftRevision: revision,
          appliedByUserId: input.userId,
          clientApplyId: request.clientApplyId,
          applyDigest: digest,
          appliedAt: input.now,
        },
      });
      await appendAuditEventTransactional(
        transaction,
        this.auditTrail,
        buildLocatorRepairAppliedInput({
          workspaceId: proposal.workspaceId,
          actor: { type: 'user', userId: input.userId },
          proposalId: proposal.id,
          candidateId: candidate.id,
          workflowRunId: proposal.workflowRunId,
          stepId: proposal.stepId,
          stepIndex: proposal.stepIndex,
          targetDraftVersionId: target.id,
          previousRevision: request.expectedRevision,
          newRevision: revision,
          appliedAt: input.now,
        }),
      );
      return {
        idempotent: false,
        proposalId: proposal.id,
        targetDraftVersionId: target.id,
        revision,
      };
    });
  }

  private async hasCompatibleLineage(
    transaction: Prisma.TransactionClient,
    startingVersionId: string | null,
    sourceVersionId: string,
    workflowId: string,
  ): Promise<boolean> {
    let current = startingVersionId;
    for (let depth = 0; depth < 32 && current !== null; depth += 1) {
      if (current === sourceVersionId) return true;
      const row = await transaction.workflowVersion.findFirst({
        where: { id: current, workflowId },
        select: { createdFromVersionId: true },
      });
      if (row === null) return false;
      current = row.createdFromVersionId;
    }
    return false;
  }

  private async workspaceAccess(userId: string, workspaceId: string) {
    const member = await this.prisma.organizationMember.findFirst({
      where: {
        userId,
        organization: { workspaces: { some: { id: workspaceId } } },
      },
      select: { organizationId: true, role: true },
    });
    if (member === null) {
      throw new WorkflowLocatorRepairRepositoryError(
        'LOCATOR_REPAIR_FORBIDDEN',
      );
    }
    return { userId, workspaceId, ...member };
  }

  private async runSerializable<Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
  ): Promise<Result> {
    for (let attempt = 0; attempt < MAX_SERIALIZATION_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error: unknown) {
        const retry =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' || error.code === 'P2028');
        if (!retry) throw error;
        if (attempt === MAX_SERIALIZATION_ATTEMPTS - 1) {
          throw new WorkflowLocatorRepairRepositoryError(
            'SERIALIZATION_FAILURE',
          );
        }
      }
    }
    throw new WorkflowLocatorRepairRepositoryError('SERIALIZATION_FAILURE');
  }

  async dismissProposal(
    transaction: Prisma.TransactionClient,
    proposalId: string,
    now: Date,
    reason: 'expired' | 'invalidated',
  ): Promise<void> {
    const proposal =
      await transaction.workflowLocatorRepairProposal.findUnique({
        where: { id: proposalId },
        select: {
          workspaceId: true,
          workflowRunId: true,
          status: true,
        },
      });
    if (
      proposal === null ||
      proposal.status === WorkflowLocatorRepairProposalStatus.APPLIED
    ) {
      return;
    }
    await appendAuditEventTransactional(
      transaction,
      this.auditTrail,
      buildLocatorRepairDismissedInput({
        workspaceId: proposal.workspaceId,
        actor: { type: 'system', reason: 'automatic_expiry' },
        proposalId,
        workflowRunId: proposal.workflowRunId,
        reason,
        dismissedAt: now,
      }),
    );
  }
}
