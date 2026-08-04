import { validateEditorWorkflow } from '@tasktwin/workflow-editor-core';
import {
  WorkflowDefinitionSchema,
  type WorkflowDefinition,
} from '@tasktwin/workflow-schema';

import {
  OrganizationRole,
  Prisma,
  type PrismaClient,
} from '../generated/prisma/client.js';
import { WorkflowDraftRepositoryError } from './workflow-draft-errors.js';
import type {
  UpdateWorkflowDraftResult,
  WorkflowAccessRecord,
  WorkflowVersionDetailRecord,
  WorkspaceWorkflowListRecord,
} from './workflow-draft-records.js';

const MAX_SERIALIZABLE_ATTEMPTS = 3;
const WRITER_ROLES = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
  OrganizationRole.MEMBER,
] as const;

function isPrismaErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

function toAccessRecord(
  userId: string,
  membership: { organizationId: string; role: OrganizationRole },
): WorkflowAccessRecord {
  return {
    organizationId: membership.organizationId,
    userId,
    role: membership.role,
  };
}

const detailSelect = {
  id: true,
  workflowId: true,
  version: true,
  revision: true,
  status: true,
  schemaVersion: true,
  definition: true,
  createdFromVersionId: true,
  clientCreationId: true,
  publishedAt: true,
  publishedById: true,
  archivedAt: true,
  archivedById: true,
  createdAt: true,
  updatedAt: true,
  recordingConversion: {
    select: {
      conversionReport: true,
    },
  },
  appliedLocatorRepairProposals: {
    where: { status: 'APPLIED' },
    select: {
      id: true,
      stepId: true,
      selectedCandidate: {
        select: { strategy: true, confidence: true },
      },
    },
  },
  workflow: {
    select: {
      workspaceId: true,
      workspace: {
        select: {
          organization: {
            select: {
              members: {
                select: {
                  userId: true,
                  organizationId: true,
                  role: true,
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.WorkflowVersionSelect;

type DetailRow = Prisma.WorkflowVersionGetPayload<{
  select: typeof detailSelect;
}>;

function toDetailRecord(
  row: DetailRow,
  actorUserId: string,
): WorkflowVersionDetailRecord {
  const membership = row.workflow.workspace.organization.members.find(
    (member) => member.userId === actorUserId,
  );
  if (membership === undefined) {
    throw new WorkflowDraftRepositoryError('WORKFLOW_VERSION_NOT_FOUND');
  }

  const definition = WorkflowDefinitionSchema.safeParse(row.definition);
  if (!definition.success) {
    throw new WorkflowDraftRepositoryError('PERSISTED_WORKFLOW_INVALID');
  }

  return {
    id: row.id,
    workflowId: row.workflowId,
    workspaceId: row.workflow.workspaceId,
    version: row.version,
    revision: row.revision,
    status: row.status,
    schemaVersion: row.schemaVersion,
    definition: definition.data as Prisma.JsonValue,
    createdFromVersionId: row.createdFromVersionId,
    clientCreationId: row.clientCreationId,
    publishedAt: row.publishedAt,
    publishedById: row.publishedById,
    archivedAt: row.archivedAt,
    archivedById: row.archivedById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    conversionReport: row.recordingConversion?.conversionReport ?? null,
    locatorRepairMetadata: (row.appliedLocatorRepairProposals ?? []).flatMap(
      (proposal) =>
        proposal.selectedCandidate === null
          ? []
          : [
              {
                proposalId: proposal.id,
                stepId: proposal.stepId,
                strategy: proposal.selectedCandidate.strategy,
                confidence: proposal.selectedCandidate.confidence,
              },
            ],
    ),
    access: toAccessRecord(actorUserId, membership),
  };
}

export class WorkflowDraftRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async resolveWorkflowVersionAccess(
    actorUserId: string,
    workflowVersionId: string,
  ): Promise<WorkflowAccessRecord | null> {
    const row = await this.prisma.workflowVersion.findFirst({
      where: {
        id: workflowVersionId,
        workflow: {
          workspace: {
            organization: {
              members: {
                some: { userId: actorUserId },
              },
            },
          },
        },
      },
      select: {
        workflow: {
          select: {
            workspace: {
              select: {
                organization: {
                  select: {
                    members: {
                      where: { userId: actorUserId },
                      take: 1,
                      select: {
                        organizationId: true,
                        role: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const membership = row?.workflow.workspace.organization.members[0];
    return membership === undefined
      ? null
      : toAccessRecord(actorUserId, membership);
  }

  async listForWorkspace(
    actorUserId: string,
    workspaceId: string,
  ): Promise<WorkspaceWorkflowListRecord | null> {
    const membership = await this.prisma.organizationMember.findFirst({
      where: {
        userId: actorUserId,
        organization: {
          workspaces: {
            some: { id: workspaceId },
          },
        },
      },
      select: {
        organizationId: true,
        role: true,
      },
    });
    if (membership === null) {
      return null;
    }

    const rows = await this.prisma.workflow.findMany({
      where: {
        workspaceId,
        workspace: {
          organizationId: membership.organizationId,
        },
        versions: { some: {} },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        versions: {
          orderBy: [{ version: 'desc' }, { id: 'asc' }],
          take: 1,
          select: {
            id: true,
            version: true,
            revision: true,
            status: true,
            updatedAt: true,
          },
        },
      },
    });

    return {
      workspaceId,
      access: toAccessRecord(actorUserId, membership),
      workflows: rows.flatMap((row) => {
        const latest = row.versions[0];
        return latest === undefined
          ? []
          : [
              {
                id: row.id,
                name: row.name,
                description: row.description,
                latestVersionId: latest.id,
                version: latest.version,
                revision: latest.revision,
                status: latest.status,
                updatedAt: latest.updatedAt,
              },
            ];
      }),
    };
  }

  async getVersion(
    actorUserId: string,
    workflowVersionId: string,
  ): Promise<WorkflowVersionDetailRecord | null> {
    const row = await this.prisma.workflowVersion.findFirst({
      where: {
        id: workflowVersionId,
        workflow: {
          workspace: {
            organization: {
              members: {
                some: { userId: actorUserId },
              },
            },
          },
        },
      },
      select: {
        ...detailSelect,
        workflow: {
          select: {
            ...detailSelect.workflow.select,
            workspace: {
              select: {
                ...detailSelect.workflow.select.workspace.select,
                organization: {
                  select: {
                    members: {
                      where: { userId: actorUserId },
                      take: 1,
                      select: {
                        userId: true,
                        organizationId: true,
                        role: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    return row === null ? null : toDetailRecord(row, actorUserId);
  }

  async updateDraft(
    actorUserId: string,
    workflowVersionId: string,
    expectedRevision: number,
    definitionInput: unknown,
  ): Promise<UpdateWorkflowDraftResult> {
    const definition = WorkflowDefinitionSchema.safeParse(definitionInput);
    if (
      !definition.success ||
      validateEditorWorkflow(definitionInput).length > 0
    ) {
      throw new WorkflowDraftRepositoryError('WORKFLOW_DEFINITION_INVALID');
    }

    return this.runSerializable(async (transaction) => {
      const current = await transaction.workflowVersion.findFirst({
        where: {
          id: workflowVersionId,
          workflow: {
            workspace: {
              organization: {
                members: {
                  some: { userId: actorUserId },
                },
              },
            },
          },
        },
        select: {
          ...detailSelect,
          workflow: {
            select: {
              ...detailSelect.workflow.select,
              workspace: {
                select: {
                  ...detailSelect.workflow.select.workspace.select,
                  organization: {
                    select: {
                      members: {
                        where: { userId: actorUserId },
                        take: 1,
                        select: {
                          userId: true,
                          organizationId: true,
                          role: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (current === null) {
        throw new WorkflowDraftRepositoryError('WORKFLOW_VERSION_NOT_FOUND');
      }

      const membership = current.workflow.workspace.organization.members[0];
      if (
        membership === undefined ||
        !WRITER_ROLES.includes(membership.role as (typeof WRITER_ROLES)[number])
      ) {
        throw new WorkflowDraftRepositoryError('WORKFLOW_DRAFT_FORBIDDEN');
      }
      if (current.status !== 'draft') {
        throw new WorkflowDraftRepositoryError('WORKFLOW_VERSION_NOT_DRAFT');
      }
      this.assertImmutableFields(current, definition.data);
      if (current.revision !== expectedRevision) {
        throw new WorkflowDraftRepositoryError(
          'WORKFLOW_DRAFT_REVISION_CONFLICT',
          current.revision,
        );
      }

      const updated = await transaction.workflowVersion.updateMany({
        where: {
          id: workflowVersionId,
          status: 'draft',
          revision: expectedRevision,
        },
        data: {
          definition: definition.data as Prisma.InputJsonValue,
          revision: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        const latest = await transaction.workflowVersion.findUnique({
          where: { id: workflowVersionId },
          select: { revision: true },
        });
        throw new WorkflowDraftRepositoryError(
          'WORKFLOW_DRAFT_REVISION_CONFLICT',
          latest?.revision,
        );
      }

      await transaction.workflow.update({
        where: { id: current.workflowId },
        data: {
          name: definition.data.name,
          description: definition.data.description ?? null,
        },
      });

      const result = await transaction.workflowVersion.findUniqueOrThrow({
        where: { id: workflowVersionId },
        select: {
          ...detailSelect,
          workflow: {
            select: {
              ...detailSelect.workflow.select,
              workspace: {
                select: {
                  ...detailSelect.workflow.select.workspace.select,
                  organization: {
                    select: {
                      members: {
                        where: { userId: actorUserId },
                        take: 1,
                        select: {
                          userId: true,
                          organizationId: true,
                          role: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      return { workflowVersion: toDetailRecord(result, actorUserId) };
    });
  }

  private assertImmutableFields(
    current: Pick<
      DetailRow,
      'workflowId' | 'version' | 'schemaVersion' | 'status'
    >,
    definition: WorkflowDefinition,
  ): void {
    if (definition.workflowId !== current.workflowId) {
      throw new WorkflowDraftRepositoryError('WORKFLOW_ID_IMMUTABLE');
    }
    if (definition.version !== current.version) {
      throw new WorkflowDraftRepositoryError('WORKFLOW_VERSION_IMMUTABLE');
    }
    if (definition.schemaVersion !== current.schemaVersion) {
      throw new WorkflowDraftRepositoryError(
        'WORKFLOW_SCHEMA_VERSION_IMMUTABLE',
      );
    }
    if (definition.status !== 'draft') {
      throw new WorkflowDraftRepositoryError('WORKFLOW_STATUS_INVALID');
    }
  }

  private async runSerializable<Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
  ): Promise<Result> {
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error: unknown) {
        if (!isPrismaErrorCode(error, 'P2034')) {
          throw error;
        }
        if (attempt === MAX_SERIALIZABLE_ATTEMPTS) {
          throw new WorkflowDraftRepositoryError('SERIALIZATION_FAILURE');
        }
      }
    }

    throw new WorkflowDraftRepositoryError('SERIALIZATION_FAILURE');
  }
}
