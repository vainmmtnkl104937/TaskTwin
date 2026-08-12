import {
  ApprovalRiskLevelSchema,
  MAX_APPROVAL_TIMEOUT_MS,
  MIN_APPROVAL_TIMEOUT_MS,
} from '@tasktwin/workflow-schema';
import { z } from 'zod';

import {
  APPROVAL_POLL_INTERVAL_SECONDS,
  MAX_APPROVAL_ISSUES,
  WORKFLOW_APPROVAL_SCHEMA_VERSION,
} from './constants.js';

export const ApprovalRequestStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
  'INVALIDATED',
]);

export const ApprovalDecisionSchema = z.enum([
  'approved',
  'rejected',
  'expired',
  'cancelled',
  'invalidated',
]);

export const ApprovalBindingSchema = z.strictObject({
  approvalStepId: z.string().trim().min(1).max(256),
  approvalStepIndex: z.number().int().nonnegative(),
  gatedStepId: z.string().trim().min(1).max(256),
  gatedStepIndex: z.number().int().nonnegative(),
  riskLevel: ApprovalRiskLevelSchema,
  timeoutMs: z
    .number()
    .int()
    .min(MIN_APPROVAL_TIMEOUT_MS)
    .max(MAX_APPROVAL_TIMEOUT_MS),
});

export const ApprovalIssueCodeSchema = z.enum([
  'APPROVAL_STEP_ORPHANED',
  'APPROVAL_GATED_STEP_INVALID',
]);

export const ApprovalAnalysisIssueSchema = z.strictObject({
  code: ApprovalIssueCodeSchema,
  message: z.string().trim().min(1).max(200),
  path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
  stepId: z.string().trim().min(1).max(256),
  stepIndex: z.number().int().nonnegative(),
});

export const WorkflowApprovalAnalysisSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_APPROVAL_SCHEMA_VERSION),
  bindings: z.array(ApprovalBindingSchema).max(MAX_APPROVAL_ISSUES),
  issues: z.array(ApprovalAnalysisIssueSchema).max(MAX_APPROVAL_ISSUES),
  hasBlockingIssues: z.boolean(),
});

export const SafeApprovalSummarySchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_APPROVAL_SCHEMA_VERSION),
  approvalStepId: z.string().trim().min(1).max(256),
  gatedStepId: z.string().trim().min(1).max(256),
  riskLevel: ApprovalRiskLevelSchema,
  status: ApprovalRequestStatusSchema,
});

export const ApprovalCoordinatorRequestSchema = z.strictObject({
  executionId: z.string().uuid(),
  workflowId: z.string().trim().min(1).max(256),
  workflowVersion: z.number().int().positive(),
  approvalStepId: z.string().trim().min(1).max(256),
  gatedStepId: z.string().trim().min(1).max(256),
  riskLevel: ApprovalRiskLevelSchema,
  expiresAt: z.string().datetime({ offset: true }),
});

export const ApprovalCoordinatorResultSchema = z.strictObject({
  decision: ApprovalDecisionSchema,
  decidedAt: z.string().datetime({ offset: true }),
});

export const RunnerApprovalRequestCreateSchema = z.strictObject({
  clientRequestId: z.string().uuid(),
  approvalStepId: z.string().trim().min(1).max(256),
  gatedStepId: z.string().trim().min(1).max(256),
  expiresAt: z.string().datetime({ offset: true }),
});

export const RunnerApprovalRequestCreatedSchema = z.strictObject({
  approvalRequestId: z.string().uuid(),
  status: ApprovalRequestStatusSchema,
  requestedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  pollAfterSeconds: z
    .number()
    .int()
    .positive()
    .max(30)
    .default(APPROVAL_POLL_INTERVAL_SECONDS),
  idempotent: z.boolean(),
});

export const RunnerApprovalStatusSchema = z.strictObject({
  status: ApprovalRequestStatusSchema,
  requestedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  resolvedAt: z.string().datetime({ offset: true }).nullable(),
  pollAfterSeconds: z.number().int().positive().max(30),
});

export const ApprovalDecisionRequestSchema = z.strictObject({
  clientDecisionId: z.string().uuid(),
});

const SafeApprovalStepSchema = z.strictObject({
  id: z.string().trim().min(1).max(256),
  name: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(1000),
});

const SafeGatedStepSchema = z.strictObject({
  id: z.string().trim().min(1).max(256),
  name: z.string().trim().min(1).max(200),
  type: z.string().trim().min(1).max(32),
});

export const SafeApprovalRequestSchema = z.strictObject({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  workflowRunId: z.string().uuid(),
  workflowId: z.string().trim().min(1).max(256),
  workflowName: z.string().trim().min(1).max(200),
  workflowVersion: z.number().int().positive(),
  approvalStep: SafeApprovalStepSchema,
  gatedStep: SafeGatedStepSchema,
  riskLevel: ApprovalRiskLevelSchema,
  status: ApprovalRequestStatusSchema,
  requestedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  resolvedAt: z.string().datetime({ offset: true }).nullable(),
});

export const ApprovalRequestListResponseSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_APPROVAL_SCHEMA_VERSION),
  workspaceId: z.string().uuid(),
  access: z.strictObject({
    role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']),
    canDecide: z.boolean(),
  }),
  requests: z.array(SafeApprovalRequestSchema).max(100),
  nextCursor: z.string().max(512).nullable(),
});

export const ApprovalRequestDetailResponseSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_APPROVAL_SCHEMA_VERSION),
  access: z.strictObject({
    role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']),
    canDecide: z.boolean(),
  }),
  request: SafeApprovalRequestSchema,
});

export const ApprovalDecisionResponseSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_APPROVAL_SCHEMA_VERSION),
  idempotent: z.boolean(),
  request: SafeApprovalRequestSchema,
});

export type ApprovalRequestStatus = z.infer<typeof ApprovalRequestStatusSchema>;
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
export type ApprovalBinding = z.infer<typeof ApprovalBindingSchema>;
export type ApprovalAnalysisIssue = z.infer<typeof ApprovalAnalysisIssueSchema>;
export type WorkflowApprovalAnalysis = z.infer<
  typeof WorkflowApprovalAnalysisSchema
>;
export type SafeApprovalSummary = z.infer<typeof SafeApprovalSummarySchema>;
export type ApprovalCoordinatorRequest = z.infer<
  typeof ApprovalCoordinatorRequestSchema
>;
export type ApprovalCoordinatorResult = z.infer<
  typeof ApprovalCoordinatorResultSchema
>;
export type RunnerApprovalRequestCreate = z.infer<
  typeof RunnerApprovalRequestCreateSchema
>;
export type RunnerApprovalRequestCreated = z.infer<
  typeof RunnerApprovalRequestCreatedSchema
>;
export type RunnerApprovalStatus = z.infer<typeof RunnerApprovalStatusSchema>;
export type ApprovalDecisionRequest = z.infer<
  typeof ApprovalDecisionRequestSchema
>;
export type SafeApprovalRequest = z.infer<typeof SafeApprovalRequestSchema>;
export type ApprovalRequestListResponse = z.infer<
  typeof ApprovalRequestListResponseSchema
>;
export type ApprovalRequestDetailResponse = z.infer<
  typeof ApprovalRequestDetailResponseSchema
>;
export type ApprovalDecisionResponse = z.infer<
  typeof ApprovalDecisionResponseSchema
>;
