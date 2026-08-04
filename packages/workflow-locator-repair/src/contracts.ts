import {
  LocatorCandidateSchema,
  LocatorConfidenceSchema,
  LocatorObservationSchema,
  LocatorReasonCodeSchema,
  LocatorSourceSchema,
} from '@tasktwin/locator-engine';
import {
  PrivacyClassificationInputSchema,
  PrivacyDecisionSchema,
  PrivacyRuleIdSchema,
  SensitivitySchema,
} from '@tasktwin/privacy-engine';
import { ExecutionEffectCertaintySchema } from '@tasktwin/workflow-recovery';
import {
  ElementLocatorSchema,
  WorkflowStepSchema,
} from '@tasktwin/workflow-schema';
import { z } from 'zod';

import {
  LOCATOR_REPAIR_POLL_INTERVAL_SECONDS,
  MAX_LOCATOR_REPAIR_CANDIDATES,
  MAX_LOCATOR_REPAIR_EVIDENCE_CODES,
  MAX_LOCATOR_REPAIR_OBSERVATIONS,
  WORKFLOW_LOCATOR_REPAIR_SCHEMA_VERSION,
} from './constants.js';

export const UuidSchema = z.string().uuid();
export const IsoDateSchema = z.string().datetime({ offset: true });
export const Sha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const LocatorRepairFailureCodeSchema = z.enum([
  'LOCATOR_NOT_FOUND',
  'LOCATOR_NOT_UNIQUE',
]);

export const LocatorRepairIneligibilityCodeSchema = z.enum([
  'UNSUPPORTED_FAILURE',
  'UNSUPPORTED_STEP',
  'ELEMENT_LOCATOR_REQUIRED',
  'EFFECT_NOT_SAFE',
  'APPROVAL_GATED_STEP',
]);

export const LocatorRepairEligibilityInputSchema = z.strictObject({
  step: WorkflowStepSchema,
  errorCode: z.string().trim().min(1).max(80),
  effectCertainty: ExecutionEffectCertaintySchema,
  approvalGated: z.boolean().default(false),
});

export const LocatorRepairEligibilityDecisionSchema = z.discriminatedUnion(
  'eligible',
  [
    z.strictObject({
      eligible: z.literal(true),
      failureCode: LocatorRepairFailureCodeSchema,
      locator: ElementLocatorSchema,
    }),
    z.strictObject({
      eligible: z.literal(false),
      reason: LocatorRepairIneligibilityCodeSchema,
    }),
  ],
);

export const LocatorRepairEvidenceCodeSchema = z.enum([
  'RECORDED_PRIMARY_MATCH',
  'RECORDED_FALLBACK_MATCH',
  'TARGET_TEST_ID_MATCH',
  'TARGET_ROLE_MATCH',
  'TARGET_LABEL_MATCH',
  'TARGET_PLACEHOLDER_MATCH',
  'TARGET_STABLE_ID_MATCH',
  'TARGET_SAFE_TEXT_MATCH',
  'STEP_CONTROL_COMPATIBLE',
  'PRIVACY_ALLOWED',
]);

export const LocatorRepairElementKindSchema = z.enum([
  'button',
  'link',
  'text_input',
  'select',
  'checkbox',
  'radio',
  'generic',
]);

export const LocatorRepairCandidateInputSchema = z.strictObject({
  observation: LocatorObservationSchema,
  privacyInput: PrivacyClassificationInputSchema,
  privacyDecision: PrivacyDecisionSchema,
  elementKind: LocatorRepairElementKindSchema,
  evidenceCodes: z
    .array(LocatorRepairEvidenceCodeSchema)
    .min(1)
    .max(MAX_LOCATOR_REPAIR_EVIDENCE_CODES),
});

export const LocatorRepairCandidateInputListSchema = z
  .array(LocatorRepairCandidateInputSchema)
  .max(MAX_LOCATOR_REPAIR_OBSERVATIONS);

export const RankedLocatorRepairCandidateSchema = z.strictObject({
  candidate: LocatorCandidateSchema,
  confidence: LocatorConfidenceSchema,
  elementKind: LocatorRepairElementKindSchema,
  evidenceCodes: z
    .array(LocatorRepairEvidenceCodeSchema)
    .min(1)
    .max(MAX_LOCATOR_REPAIR_EVIDENCE_CODES),
  privacyDecision: PrivacyDecisionSchema,
});

export const RankedLocatorRepairCandidateListSchema = z
  .array(RankedLocatorRepairCandidateSchema)
  .max(MAX_LOCATOR_REPAIR_CANDIDATES);

export const LocatorRepairProposalStatusSchema = z.enum([
  'OPEN',
  'READY',
  'APPLIED',
  'EXPIRED',
  'INVALIDATED',
]);

export const LocatorRepairCandidateTestStatusSchema = z.enum([
  'NOT_REQUESTED',
  'PENDING',
  'PASSED',
  'NOT_FOUND',
  'NOT_UNIQUE',
  'NOT_ACTIONABLE',
  'INCOMPATIBLE_ELEMENT',
  'STALE_PAGE_CONTEXT',
  'CANCELLED',
  'ERROR',
]);

export const LocatorRepairTestObservationCodeSchema = z.enum([
  'UNIQUE_MATCH',
  'VISIBLE',
  'HIDDEN',
  'ENABLED',
  'EDITABLE',
  'CONTROL_COMPATIBLE',
  'STATE_READABLE',
]);

export const RunnerLocatorRepairCandidateSchema = z.strictObject({
  clientCandidateId: UuidSchema,
  locator: ElementLocatorSchema,
  source: LocatorSourceSchema,
  score: z.number().int().min(0).max(100),
  confidence: LocatorConfidenceSchema,
  elementKind: LocatorRepairElementKindSchema,
  reasonCodes: z
    .array(LocatorReasonCodeSchema)
    .min(1)
    .max(MAX_LOCATOR_REPAIR_EVIDENCE_CODES),
  evidenceCodes: z
    .array(LocatorRepairEvidenceCodeSchema)
    .min(1)
    .max(MAX_LOCATOR_REPAIR_EVIDENCE_CODES),
  privacyInput: PrivacyClassificationInputSchema,
  privacyDecision: PrivacyDecisionSchema,
});

export const RunnerLocatorRepairProposalCreateSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_LOCATOR_REPAIR_SCHEMA_VERSION),
  clientProposalId: UuidSchema,
  repairRequestId: UuidSchema,
  pageContextDigest: Sha256DigestSchema,
  generatedAt: IsoDateSchema,
  candidates: z
    .array(RunnerLocatorRepairCandidateSchema)
    .max(MAX_LOCATOR_REPAIR_CANDIDATES),
});

export const RunnerLocatorRepairProposalCreatedSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_LOCATOR_REPAIR_SCHEMA_VERSION),
  proposalId: UuidSchema,
  status: LocatorRepairProposalStatusSchema,
  expiresAt: IsoDateSchema,
  idempotent: z.boolean(),
  candidates: z.array(
    z.strictObject({
      clientCandidateId: UuidSchema,
      candidateId: UuidSchema,
    }),
  ),
});

export const LocatorRepairDiscoverySeedSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_LOCATOR_REPAIR_SCHEMA_VERSION),
  repairRequestId: UuidSchema,
  sourceStepDigest: Sha256DigestSchema,
  sourceLocatorDigest: Sha256DigestSchema,
  step: WorkflowStepSchema,
  sourceLocator: ElementLocatorSchema,
  recordedFallbacks: z.array(ElementLocatorSchema).max(4),
});

export const LocatorRepairCandidateTestRequestSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_LOCATOR_REPAIR_SCHEMA_VERSION),
  clientTestRequestId: UuidSchema,
});

export const LocatorRepairCandidateTestRequestResponseSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_LOCATOR_REPAIR_SCHEMA_VERSION),
  candidateId: UuidSchema,
  status: LocatorRepairCandidateTestStatusSchema,
  idempotent: z.boolean(),
});

export const RunnerLocatorRepairCandidateTestCommandSchema = z.strictObject({
  candidateId: UuidSchema,
  proposalId: UuidSchema,
  pageContextDigest: Sha256DigestSchema,
  locator: ElementLocatorSchema,
  elementKind: LocatorRepairElementKindSchema,
  requirement: z.enum([
    'click_actionable',
    'fill_editable',
    'select_actionable',
    'checked_actionable',
    'verify_readable',
    'extract_readable',
  ]),
});

export const RunnerLocatorRepairPollResponseSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_LOCATOR_REPAIR_SCHEMA_VERSION),
  proposalId: UuidSchema,
  status: LocatorRepairProposalStatusSchema,
  command: RunnerLocatorRepairCandidateTestCommandSchema.nullable(),
  pollAfterSeconds: z
    .number()
    .int()
    .positive()
    .max(30)
    .default(LOCATOR_REPAIR_POLL_INTERVAL_SECONDS),
});

export const RunnerLocatorRepairCandidateTestResultSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_LOCATOR_REPAIR_SCHEMA_VERSION),
  clientTestResultId: UuidSchema,
  pageContextDigest: Sha256DigestSchema,
  status: LocatorRepairCandidateTestStatusSchema.exclude([
    'NOT_REQUESTED',
    'PENDING',
  ]),
  observations: z
    .array(LocatorRepairTestObservationCodeSchema)
    .max(MAX_LOCATOR_REPAIR_EVIDENCE_CODES),
});

export const SafeLocatorRepairCandidateSummarySchema = z.strictObject({
  id: UuidSchema,
  rank: z.number().int().positive().max(MAX_LOCATOR_REPAIR_CANDIDATES),
  strategy: LocatorSourceSchema,
  score: z.number().int().min(0).max(100),
  confidence: LocatorConfidenceSchema,
  evidenceCodes: z.array(LocatorRepairEvidenceCodeSchema),
  privacyClassification: SensitivitySchema,
  privacyRuleIds: z.array(PrivacyRuleIdSchema),
  testStatus: LocatorRepairCandidateTestStatusSchema,
  testedAt: IsoDateSchema.nullable(),
});

export const SafeLocatorRepairProposalSchema = z.strictObject({
  id: UuidSchema,
  workspaceId: UuidSchema,
  workflowRunId: UuidSchema,
  workflowId: z.string().trim().min(1).max(256),
  sourceWorkflowVersionId: UuidSchema,
  sourceWorkflowVersion: z.number().int().positive(),
  repairRequestId: UuidSchema,
  step: z.strictObject({
    id: z.string().trim().min(1).max(256),
    index: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(200),
    type: z.string().trim().min(1).max(32),
  }),
  failedAttemptNumber: z.number().int().positive().max(3),
  status: LocatorRepairProposalStatusSchema,
  candidates: z.array(SafeLocatorRepairCandidateSummarySchema),
  selectedCandidateId: UuidSchema.nullable(),
  appliedDraftVersionId: UuidSchema.nullable(),
  appliedDraftRevision: z.number().int().positive().nullable(),
  expiresAt: IsoDateSchema,
  createdAt: IsoDateSchema,
});

export const LocatorRepairProposalAccessSchema = z.strictObject({
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']),
  canTest: z.boolean(),
  canApply: z.boolean(),
});

export const LocatorRepairProposalDetailResponseSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_LOCATOR_REPAIR_SCHEMA_VERSION),
  access: LocatorRepairProposalAccessSchema,
  proposal: SafeLocatorRepairProposalSchema,
});

export const LocatorRepairProposalListResponseSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_LOCATOR_REPAIR_SCHEMA_VERSION),
  workspaceId: UuidSchema,
  access: LocatorRepairProposalAccessSchema,
  proposals: z.array(SafeLocatorRepairProposalSchema).max(1000),
});

export const ApplyLocatorRepairToDraftRequestSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_LOCATOR_REPAIR_SCHEMA_VERSION),
  clientApplyId: UuidSchema,
  candidateId: UuidSchema,
  targetDraftVersionId: UuidSchema,
  expectedRevision: z.number().int().positive(),
});

export const ApplyLocatorRepairToDraftResponseSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_LOCATOR_REPAIR_SCHEMA_VERSION),
  idempotent: z.boolean(),
  proposalId: UuidSchema,
  targetDraftVersionId: UuidSchema,
  revision: z.number().int().positive(),
});

export const LocatorRepairErrorCodeSchema = z.enum([
  'LOCATOR_REPAIR_NOT_ELIGIBLE',
  'LOCATOR_REPAIR_INVALID',
  'LOCATOR_REPAIR_NOT_FOUND',
  'LOCATOR_REPAIR_FORBIDDEN',
  'LOCATOR_REPAIR_CONFLICT',
  'LOCATOR_REPAIR_EXPIRED',
  'LOCATOR_REPAIR_STALE_PAGE_CONTEXT',
  'LOCATOR_REPAIR_CANDIDATE_NOT_TESTED',
  'LOCATOR_REPAIR_DRAFT_REQUIRED',
  'LOCATOR_REPAIR_LINEAGE_MISMATCH',
  'LOCATOR_REPAIR_LOCATOR_CHANGED',
  'LOCATOR_REPAIR_REVISION_CONFLICT',
]);

export type LocatorRepairEligibilityInput = z.infer<
  typeof LocatorRepairEligibilityInputSchema
>;
export type LocatorRepairEligibilityDecision = z.infer<
  typeof LocatorRepairEligibilityDecisionSchema
>;
export type LocatorRepairEvidenceCode = z.infer<
  typeof LocatorRepairEvidenceCodeSchema
>;
export type LocatorRepairElementKind = z.infer<
  typeof LocatorRepairElementKindSchema
>;
export type LocatorRepairCandidateInput = z.infer<
  typeof LocatorRepairCandidateInputSchema
>;
export type RankedLocatorRepairCandidate = z.infer<
  typeof RankedLocatorRepairCandidateSchema
>;
export type RunnerLocatorRepairProposalCreate = z.infer<
  typeof RunnerLocatorRepairProposalCreateSchema
>;
export type RunnerLocatorRepairProposalCreated = z.infer<
  typeof RunnerLocatorRepairProposalCreatedSchema
>;
export type LocatorRepairDiscoverySeed = z.infer<
  typeof LocatorRepairDiscoverySeedSchema
>;
export type RunnerLocatorRepairPollResponse = z.infer<
  typeof RunnerLocatorRepairPollResponseSchema
>;
export type RunnerLocatorRepairCandidateTestCommand = z.infer<
  typeof RunnerLocatorRepairCandidateTestCommandSchema
>;
export type RunnerLocatorRepairCandidateTestResult = z.infer<
  typeof RunnerLocatorRepairCandidateTestResultSchema
>;
export type SafeLocatorRepairProposal = z.infer<
  typeof SafeLocatorRepairProposalSchema
>;
export type SafeLocatorRepairCandidateSummary = z.infer<
  typeof SafeLocatorRepairCandidateSummarySchema
>;
export type ApplyLocatorRepairToDraftRequest = z.infer<
  typeof ApplyLocatorRepairToDraftRequestSchema
>;
