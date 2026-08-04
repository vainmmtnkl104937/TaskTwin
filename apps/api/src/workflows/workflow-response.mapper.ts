import { RecordingConversionReportSchema } from '@tasktwin/recording-converter';
import {
  WorkflowDefinitionSchema,
  type WorkflowDefinition,
} from '@tasktwin/workflow-schema';
import type {
  WorkflowVersionDetailRecord,
  WorkspaceWorkflowListRecord,
} from '@tasktwin/database';
import { analyzePublishReadiness } from '@tasktwin/workflow-lifecycle';

import {
  WorkflowVersionDetailResponseSchema,
  WorkspaceWorkflowListResponseSchema,
  type WorkflowVersionDetailResponse,
  type WorkspaceWorkflowListResponse,
} from './workflow.contracts.js';

const WRITER_ROLES = new Set(['OWNER', 'ADMIN', 'MEMBER']);

function canEdit(role: string): boolean {
  return WRITER_ROLES.has(role);
}

export function toWorkspaceWorkflowListResponse(
  record: WorkspaceWorkflowListRecord,
): WorkspaceWorkflowListResponse {
  return WorkspaceWorkflowListResponseSchema.parse({
    schemaVersion: 1,
    workspaceId: record.workspaceId,
    access: {
      role: record.access.role,
      canEdit: canEdit(record.access.role),
    },
    workflows: record.workflows.map((workflow) => ({
      ...workflow,
      updatedAt: workflow.updatedAt.toISOString(),
    })),
  });
}

function toSafeLocatorMetadata(
  definition: WorkflowDefinition,
  conversionReport: unknown,
): Array<{
  stepId: string;
  confidence: 'high' | 'medium' | 'low';
  provenance: string;
}> {
  const report = RecordingConversionReportSchema.safeParse(conversionReport);
  if (!report.success) {
    return [];
  }

  const stepIds = new Set(definition.steps.map((step) => step.id));
  const seen = new Set<string>();
  return report.data.mappings.flatMap((mapping) => {
    if (
      mapping.outcome !== 'converted' ||
      !stepIds.has(mapping.stepId) ||
      seen.has(mapping.stepId)
    ) {
      return [];
    }

    seen.add(mapping.stepId);
    return [
      {
        stepId: mapping.stepId,
        confidence: mapping.locatorBundle.confidence,
        provenance: mapping.locatorBundle.primary.source,
      },
    ];
  });
}

export function toWorkflowVersionDetailResponse(
  record: WorkflowVersionDetailRecord,
): WorkflowVersionDetailResponse {
  const definition = WorkflowDefinitionSchema.parse(record.definition);
  return WorkflowVersionDetailResponseSchema.parse({
    schemaVersion: 1,
    workspaceId: record.workspaceId,
    access: {
      role: record.access.role,
      canEdit: canEdit(record.access.role) && record.status === 'draft',
    },
    workflowVersion: {
      id: record.id,
      workflowId: record.workflowId,
      version: record.version,
      revision: record.revision,
      status: record.status,
      schemaVersion: record.schemaVersion,
      definition,
      createdFromVersionId: record.createdFromVersionId,
      publishedAt: record.publishedAt?.toISOString() ?? null,
      publishedById: record.publishedById,
      archivedAt: record.archivedAt?.toISOString() ?? null,
      archivedById: record.archivedById,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    },
    locatorMetadata: [
      ...toSafeLocatorMetadata(definition, record.conversionReport).filter(
        (metadata) =>
          !(record.locatorRepairMetadata ?? []).some(
            (repair) => repair.stepId === metadata.stepId,
          ),
      ),
      ...(record.locatorRepairMetadata ?? []).map((repair) => ({
        stepId: repair.stepId,
        confidence: repair.confidence,
        provenance: `repair:${repair.proposalId}`,
      })),
    ],
    publishReadiness: analyzePublishReadiness(definition),
  });
}
