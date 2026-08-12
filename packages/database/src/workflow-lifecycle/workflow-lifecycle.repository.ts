import {
  WorkspaceExecutionPolicyDefinitionSchema,
  type WorkspaceExecutionPolicyDefinition,
} from '@tasktwin/workflow-policy';
import {
  analyzePublishReadiness,
  createDraftVersionClone,
  validateWorkflowLifecycleTransition,
  type PublishReadinessReport,
} from '@tasktwin/workflow-lifecycle';
import { WorkflowDefinitionSchema } from '@tasktwin/workflow-schema';

import {
  createAuditSourceId,
  type AuditEventInput,
} from '@tasktwin/audit-trail';

import {
  OrganizationRole,
  Prisma,
  type PrismaClient,
} from '../generated/prisma/client.js';
import {
  appendAuditEventTransactional,
  auditHasherForTrail,
} from '../audit-trail/audit-appender.repository.js';
import { WorkspaceAuditTrailRepository } from '../audit-trail/audit-trail.repository.js';
import { createCanonicalJsonDigest } from '../recording/canonical-json.js';
import type {
  WorkflowAccessRecord,
  WorkflowVersionDetailRecord,
} from '../workflow-draft/workflow-draft-records.js';
import { WorkflowLifecycleRepositoryError } from './workflow-lifecycle-errors.js';
import type {
  CreateWorkflowVersionResult,
  WorkflowLifecycleActionResult,
  WorkflowVersionHistoryRecord,
} from './workflow-lifecycle-records.js';

const MAX_SERIALIZABLE_ATTEMPTS = 3;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EDITOR_ROLES = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
  OrganizationRole.MEMBER,
] as const;
const PUBLISHER_ROLES = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
] as const;

function buildTransitionSourceId(
  eventType: string,
  workflowVersionId: string,
  revision: number,
): string {
  return createAuditSourceId(
    'workflow_version_transition',
    [eventType, workflowVersionId, revision],
    auditHasherForTrail,
  );
}

function buildDraftCreatedSourceId(
  workflowVersionId: string,
  version: number,
  clientCreationId: string,
): string {
  return createAuditSourceId(
    'workflow_version_created',
    [workflowVersionId, version, clientCreationId],
    auditHasherForTrail,
  );
}

function buildPublishedSourceId(
  workflowVersionId: string,
  revision: number,
): string {
  return createAuditSourceId(
    'workflow_version_published',
    [workflowVersionId, revision],
    auditHasherForTrail,
  );
}

function buildArchivedSourceId(
  eventType: 'workflow_version.archived',
  workflowVersionId: string,
  revision: number,
  reason: 'manual' | 'replaced_by_publish',
): string {
  return createAuditSourceId(
    'workflow_version_archived',
    [workflowVersionId, revision, reason],
    auditHasherForTrail,
  );
}

function buildWorkflowVersionTransitionInput(input: {
  eventType:
    | 'workflow_version.submitted_for_testing'
    | 'workflow_version.returned_to_draft';
  workspaceId: string;
  actor: { type: 'user'; userId: string };
  version: WorkflowVersionDetailRecord;
  occurredAt: Date;
  sourceId: string;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: input.eventType,
    actor: input.actor,
    primaryEntity: {
      kind: 'workflow_version',
      id: input.version.id,
    },
    relatedEntities: [{ kind: 'workflow', id: input.version.workflowId }],
    occurredAt: input.occurredAt,
    sourceId: input.sourceId,
    payload: {
      workflowId: input.version.workflowId,
      workflowVersionId: input.version.id,
      version: input.version.version,
      revision: input.version.revision,
    },
  };
}

function buildWorkflowVersionCreatedInput(input: {
  workspaceId: string;
  actor: { type: 'user'; userId: string };
  version: WorkflowVersionDetailRecord;
  sourceVersionId: string;
  occurredAt: Date;
  sourceId: string;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'workflow_version.created',
    actor: input.actor,
    primaryEntity: { kind: 'workflow_version', id: input.version.id },
    relatedEntities: [{ kind: 'workflow', id: input.version.workflowId }],
    occurredAt: input.occurredAt,
    sourceId: input.sourceId,
    payload: {
      workflowId: input.version.workflowId,
      workflowVersionId: input.version.id,
      version: input.version.version,
      revision: input.version.revision,
      sourceVersionId: input.sourceVersionId,
      schemaVersion: input.version.schemaVersion,
    },
  };
}

function buildWorkflowVersionPublishedInput(input: {
  workspaceId: string;
  actor: { type: 'user'; userId: string };
  version: WorkflowVersionDetailRecord;
  workflowDigest: string;
  replacedVersionId: string | null;
  occurredAt: Date;
  sourceId: string;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'workflow_version.published',
    actor: input.actor,
    primaryEntity: { kind: 'workflow_version', id: input.version.id },
    relatedEntities: [
      { kind: 'workflow', id: input.version.workflowId },
      ...(input.replacedVersionId === null
        ? []
        : [{ kind: 'workflow_version' as const, id: input.replacedVersionId }]),
    ],
    occurredAt: input.occurredAt,
    sourceId: input.sourceId,
    payload: {
      workflowId: input.version.workflowId,
      workflowVersionId: input.version.id,
      version: input.version.version,
      revision: input.version.revision,
      workflowDigest: input.workflowDigest,
      ...(input.replacedVersionId === null
        ? {}
        : { replacedVersionId: input.replacedVersionId }),
    },
  };
}

function buildWorkflowVersionArchivedInput(input: {
  workspaceId: string;
  actor: { type: 'user'; userId: string };
  version: WorkflowVersionDetailRecord;
  reason: 'manual' | 'replaced_by_publish';
  occurredAt: Date;
  sourceId: string;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'workflow_version.archived',
    actor: input.actor,
    primaryEntity: { kind: 'workflow_version', id: input.version.id },
    relatedEntities: [{ kind: 'workflow', id: input.version.workflowId }],
    occurredAt: input.occurredAt,
    sourceId: input.sourceId,
    payload: {
      workflowId: input.version.workflowId,
      workflowVersionId: input.version.id,
      version: input.version.version,
      revision: input.version.revision,
      reason: input.reason,
    },
  };
}

function isSerializationConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  if ('cause' in error) {
    const directCause = error.cause;
    if (
      typeof directCause === 'object' &&
      directCause !== null &&
      'originalCode' in directCause &&
      directCause.originalCode === '40001'
    ) {
      return true;
    }
  }
  if (!('code' in error)) {
    return false;
  }
  if (error.code === 'P2034' || error.code === 'P2002') {
    return true;
  }
  if (error.code !== 'P2010' || !('meta' in error)) {
    return false;
  }

  const meta = error.meta;
  if (
    typeof meta !== 'object' ||
    meta === null ||
    !('driverAdapterError' in meta)
  ) {
    return false;
  }
  const driverError = meta.driverAdapterError;
  if (
    typeof driverError !== 'object' ||
    driverError === null ||
    !('cause' in driverError)
  ) {
    return false;
  }
  const cause = driverError.cause;
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'originalCode' in cause &&
    cause.originalCode === '40001'
  );
}

function toAccessRecord(
  actorUserId: string,
  membership: { organizationId: string; role: OrganizationRole },
): WorkflowAccessRecord {
  return {
    organizationId: membership.organizationId,
    userId: actorUserId,
    role: membership.role,
  };
}

function createDetailSelect(actorUserId: string) {
  return {
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
    workflow: {
      select: {
        workspaceId: true,
        workspace: {
          select: {
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
  } as const satisfies Prisma.WorkflowVersionSelect;
}

type DetailRow = Prisma.WorkflowVersionGetPayload<{
  select: ReturnType<typeof createDetailSelect>;
}>;

function toDetailRecord(
  row: DetailRow,
  actorUserId: string,
): WorkflowVersionDetailRecord {
  const membership = row.workflow.workspace.organization.members[0];
  if (membership === undefined) {
    throw new WorkflowLifecycleRepositoryError('WORKFLOW_VERSION_NOT_FOUND');
  }

  return {
    id: row.id,
    workflowId: row.workflowId,
    workspaceId: row.workflow.workspaceId,
    version: row.version,
    revision: row.revision,
    status: row.status,
    schemaVersion: row.schemaVersion,
    definition: row.definition,
    createdFromVersionId: row.createdFromVersionId,
    clientCreationId: row.clientCreationId,
    publishedAt: row.publishedAt,
    publishedById: row.publishedById,
    archivedAt: row.archivedAt,
    archivedById: row.archivedById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    conversionReport: row.recordingConversion?.conversionReport ?? null,
    access: toAccessRecord(actorUserId, membership),
  };
}

function hasRole(
  role: OrganizationRole,
  allowed: readonly OrganizationRole[],
): boolean {
  return allowed.includes(role);
}

export class WorkflowLifecycleRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditTrail: WorkspaceAuditTrailRepository = new WorkspaceAuditTrailRepository(
      prisma,
    ),
  ) {}

  async resolveWorkflowAccess(
    actorUserId: string,
    workflowId: string,
  ): Promise<WorkflowAccessRecord | null> {
    const row = await this.prisma.workflow.findFirst({
      where: {
        id: workflowId,
        workspace: {
          organization: {
            members: { some: { userId: actorUserId } },
          },
        },
      },
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
    });
    const membership = row?.workspace.organization.members[0];
    return membership === undefined
      ? null
      : toAccessRecord(actorUserId, membership);
  }

  async listVersions(
    actorUserId: string,
    workflowId: string,
  ): Promise<WorkflowVersionHistoryRecord | null> {
    const workflow = await this.prisma.workflow.findFirst({
      where: {
        id: workflowId,
        workspace: {
          organization: {
            members: { some: { userId: actorUserId } },
          },
        },
      },
      select: {
        id: true,
        workspaceId: true,
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
        versions: {
          orderBy: [{ version: 'desc' }, { id: 'asc' }],
          select: {
            id: true,
            workflowId: true,
            version: true,
            revision: true,
            status: true,
            schemaVersion: true,
            createdFromVersionId: true,
            publishedAt: true,
            publishedById: true,
            archivedAt: true,
            archivedById: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });
    const membership = workflow?.workspace.organization.members[0];
    if (workflow === null || membership === undefined) {
      return null;
    }

    return {
      workflowId: workflow.id,
      workspaceId: workflow.workspaceId,
      access: toAccessRecord(actorUserId, membership),
      versions: workflow.versions,
    };
  }

  submitForTesting(
    actorUserId: string,
    workflowVersionId: string,
    expectedRevision: number,
  ): Promise<WorkflowLifecycleActionResult> {
    return this.transitionWithReadiness(
      actorUserId,
      workflowVersionId,
      expectedRevision,
      'draft',
      'testing',
    );
  }

  async returnToDraft(
    actorUserId: string,
    workflowVersionId: string,
    expectedRevision: number,
  ): Promise<WorkflowLifecycleActionResult> {
    return this.runSerializable(async (transaction) => {
      const current = await this.getAccessibleVersion(
        transaction,
        actorUserId,
        workflowVersionId,
      );
      this.requireRole(current.access.role, EDITOR_ROLES);
      this.requireRevision(current.revision, expectedRevision);
      this.requireTransition(current.status, 'draft');

      const updated = await transaction.workflowVersion.updateMany({
        where: {
          id: workflowVersionId,
          status: 'testing',
          revision: expectedRevision,
        },
        data: { status: 'draft' },
      });
      if (updated.count !== 1) {
        throw new WorkflowLifecycleRepositoryError(
          'INVALID_LIFECYCLE_TRANSITION',
        );
      }

      const finalVersion = await this.getRequiredVersion(
        transaction,
        actorUserId,
        workflowVersionId,
      );
      await appendAuditEventTransactional(
        transaction,
        this.auditTrail,
        buildWorkflowVersionTransitionInput({
          eventType: 'workflow_version.returned_to_draft',
          occurredAt: new Date(),
          workspaceId: finalVersion.workspaceId,
          actor: { type: 'user', userId: actorUserId },
          version: finalVersion,
          sourceId: buildTransitionSourceId(
            'workflow_version.returned_to_draft',
            finalVersion.id,
            finalVersion.revision,
          ),
        }),
      );

      return {
        workflowVersion: finalVersion,
        readiness: null,
        idempotent: false,
      };
    });
  }

  async publish(
    actorUserId: string,
    workflowVersionId: string,
    expectedRevision: number,
    occurredAt: Date,
  ): Promise<WorkflowLifecycleActionResult> {
    this.requireTimestamp(occurredAt);

    return this.runSerializable(async (transaction) => {
      const initial = await this.getAccessibleVersion(
        transaction,
        actorUserId,
        workflowVersionId,
      );
      this.requireRole(initial.access.role, PUBLISHER_ROLES);
      await this.lockWorkflow(transaction, initial.workflowId);

      const current = await this.getRequiredVersion(
        transaction,
        actorUserId,
        workflowVersionId,
      );
      this.requireRole(current.access.role, PUBLISHER_ROLES);
      this.requireRevision(current.revision, expectedRevision);

      if (current.status === 'published') {
        return {
          workflowVersion: current,
          readiness: await this.analyzeReadiness(
            transaction,
            current.workspaceId,
            current.definition,
          ),
          idempotent: true,
        };
      }

      this.requireTransition(current.status, 'published');
      const readiness = await this.requireReadiness(
        transaction,
        current.workspaceId,
        current.definition,
      );
      const publishedDefinition = WorkflowDefinitionSchema.parse({
        ...WorkflowDefinitionSchema.parse(current.definition),
        status: 'published',
      });

      const previousPublished = await transaction.workflowVersion.findMany({
        where: {
          workflowId: current.workflowId,
          status: 'published',
          id: { not: workflowVersionId },
        },
        select: { id: true, workflowId: true, version: true, revision: true },
      });

      await transaction.workflowVersion.updateMany({
        where: {
          workflowId: current.workflowId,
          status: 'published',
          id: { not: workflowVersionId },
        },
        data: {
          status: 'archived',
          archivedAt: occurredAt,
          archivedById: actorUserId,
        },
      });

      const published = await transaction.workflowVersion.updateMany({
        where: {
          id: workflowVersionId,
          status: 'testing',
          revision: expectedRevision,
        },
        data: {
          status: 'published',
          definition: publishedDefinition as Prisma.InputJsonValue,
          publishedAt: occurredAt,
          publishedById: actorUserId,
        },
      });
      if (published.count !== 1) {
        throw new WorkflowLifecycleRepositoryError(
          'WORKFLOW_VERSION_REVISION_CONFLICT',
        );
      }

      const finalVersion = await this.getRequiredVersion(
        transaction,
        actorUserId,
        workflowVersionId,
      );

      const workflowDigest = createCanonicalJsonDigest(publishedDefinition);
      for (const archived of previousPublished) {
        await appendAuditEventTransactional(
          transaction,
          this.auditTrail,
          buildWorkflowVersionArchivedInput({
            workspaceId: current.workspaceId,
            actor: { type: 'user', userId: actorUserId },
            version: {
              id: archived.id,
              workflowId: current.workflowId,
              workspaceId: current.workspaceId,
              version: archived.version,
              revision: archived.revision,
            } as WorkflowVersionDetailRecord,
            reason: 'replaced_by_publish',
            occurredAt,
            sourceId: buildArchivedSourceId(
              'workflow_version.archived',
              archived.id,
              archived.revision,
              'replaced_by_publish',
            ),
          }),
        );
      }
      await appendAuditEventTransactional(
        transaction,
        this.auditTrail,
        buildWorkflowVersionPublishedInput({
          workspaceId: finalVersion.workspaceId,
          actor: { type: 'user', userId: actorUserId },
          version: finalVersion,
          workflowDigest,
          replacedVersionId:
            previousPublished.length === 1
              ? (previousPublished[0]?.id ?? null)
              : null,
          occurredAt,
          sourceId: buildPublishedSourceId(
            finalVersion.id,
            finalVersion.revision,
          ),
        }),
      );

      return {
        workflowVersion: finalVersion,
        readiness,
        idempotent: false,
      };
    });
  }

  async archive(
    actorUserId: string,
    workflowVersionId: string,
    occurredAt: Date,
  ): Promise<WorkflowLifecycleActionResult> {
    this.requireTimestamp(occurredAt);

    return this.runSerializable(async (transaction) => {
      const current = await this.getAccessibleVersion(
        transaction,
        actorUserId,
        workflowVersionId,
      );
      this.requireRole(current.access.role, PUBLISHER_ROLES);
      await this.lockWorkflow(transaction, current.workflowId);
      const locked = await this.getRequiredVersion(
        transaction,
        actorUserId,
        workflowVersionId,
      );
      this.requireTransition(locked.status, 'archived');

      const archived = await transaction.workflowVersion.updateMany({
        where: { id: workflowVersionId, status: 'published' },
        data: {
          status: 'archived',
          archivedAt: occurredAt,
          archivedById: actorUserId,
        },
      });
      if (archived.count !== 1) {
        throw new WorkflowLifecycleRepositoryError(
          'INVALID_LIFECYCLE_TRANSITION',
        );
      }

      const finalVersion = await this.getRequiredVersion(
        transaction,
        actorUserId,
        workflowVersionId,
      );
      await appendAuditEventTransactional(
        transaction,
        this.auditTrail,
        buildWorkflowVersionArchivedInput({
          workspaceId: finalVersion.workspaceId,
          actor: { type: 'user', userId: actorUserId },
          version: finalVersion,
          reason: 'manual',
          occurredAt,
          sourceId: buildArchivedSourceId(
            'workflow_version.archived',
            finalVersion.id,
            finalVersion.revision,
            'manual',
          ),
        }),
      );

      return {
        workflowVersion: finalVersion,
        readiness: null,
        idempotent: false,
      };
    });
  }

  async createDraftVersion(
    actorUserId: string,
    workflowId: string,
    sourceVersionId: string,
    clientCreationId: string,
    createdAt: Date,
  ): Promise<CreateWorkflowVersionResult> {
    if (
      !UUID_PATTERN.test(actorUserId) ||
      !UUID_PATTERN.test(sourceVersionId) ||
      !UUID_PATTERN.test(clientCreationId)
    ) {
      throw new WorkflowLifecycleRepositoryError('INVALID_LIFECYCLE_INPUT');
    }
    this.requireTimestamp(createdAt);

    return this.runSerializable(async (transaction) => {
      const workflow = await transaction.workflow.findFirst({
        where: {
          id: workflowId,
          workspace: {
            organization: {
              members: { some: { userId: actorUserId } },
            },
          },
        },
        select: {
          id: true,
          workspace: {
            select: {
              organization: {
                select: {
                  members: {
                    where: { userId: actorUserId },
                    take: 1,
                    select: { role: true },
                  },
                },
              },
            },
          },
        },
      });
      const membership = workflow?.workspace.organization.members[0];
      if (workflow === null || membership === undefined) {
        throw new WorkflowLifecycleRepositoryError('WORKFLOW_NOT_FOUND');
      }
      this.requireRole(membership.role, EDITOR_ROLES);
      await this.lockWorkflow(transaction, workflowId);

      const existing = await transaction.workflowVersion.findUnique({
        where: {
          workflowId_clientCreationId: { workflowId, clientCreationId },
        },
        select: {
          id: true,
          createdFromVersionId: true,
        },
      });
      if (existing !== null) {
        if (existing.createdFromVersionId !== sourceVersionId) {
          throw new WorkflowLifecycleRepositoryError(
            'WORKFLOW_VERSION_CREATION_CONFLICT',
          );
        }
        return {
          workflowVersion: await this.getRequiredVersion(
            transaction,
            actorUserId,
            existing.id,
          ),
          idempotent: true,
        };
      }

      const source = await transaction.workflowVersion.findFirst({
        where: { id: sourceVersionId, workflowId },
        select: {
          version: true,
          status: true,
          definition: true,
        },
      });
      if (source === null) {
        throw new WorkflowLifecycleRepositoryError(
          'WORKFLOW_VERSION_NOT_FOUND',
        );
      }
      if (source.status !== 'published' && source.status !== 'archived') {
        throw new WorkflowLifecycleRepositoryError(
          'SOURCE_VERSION_NOT_CLONEABLE',
        );
      }
      const sourceDefinition = WorkflowDefinitionSchema.safeParse(
        source.definition,
      );
      if (!sourceDefinition.success) {
        throw new WorkflowLifecycleRepositoryError(
          'PERSISTED_WORKFLOW_INVALID',
        );
      }

      const highest = await transaction.workflowVersion.aggregate({
        where: { workflowId },
        _max: { version: true },
      });
      const nextVersion = (highest._max.version ?? 0) + 1;
      const clone = createDraftVersionClone({
        sourceDefinition: sourceDefinition.data,
        sourceStatus: source.status,
        nextVersion,
        createdAt: createdAt.toISOString(),
      });
      if (!clone.ok) {
        throw new WorkflowLifecycleRepositoryError(
          clone.error.code === 'SOURCE_VERSION_NOT_CLONEABLE'
            ? 'SOURCE_VERSION_NOT_CLONEABLE'
            : 'INVALID_LIFECYCLE_INPUT',
        );
      }

      const created = await transaction.workflowVersion.create({
        data: {
          workflowId,
          version: clone.metadata.version,
          revision: clone.metadata.revision,
          status: 'draft',
          schemaVersion: clone.definition.schemaVersion,
          definition: clone.definition as Prisma.InputJsonValue,
          createdFromVersionId: sourceVersionId,
          clientCreationId,
          createdAt,
        },
        select: { id: true },
      });
      await transaction.workflow.update({
        where: { id: workflowId },
        data: {
          name: clone.definition.name,
          description: clone.definition.description ?? null,
        },
      });

      const workflowRow = await transaction.workflow.findFirst({
        where: { id: workflowId },
        select: { workspaceId: true },
      });
      const workspaceId = workflowRow?.workspaceId;
      if (workspaceId === undefined) {
        throw new WorkflowLifecycleRepositoryError('WORKFLOW_NOT_FOUND');
      }
      await appendAuditEventTransactional(
        transaction,
        this.auditTrail,
        buildWorkflowVersionCreatedInput({
          workspaceId,
          actor: { type: 'user', userId: actorUserId },
          version: {
            id: created.id,
            workflowId,
            workspaceId,
            version: clone.metadata.version,
            revision: clone.metadata.revision,
            schemaVersion: clone.definition.schemaVersion,
          } as WorkflowVersionDetailRecord,
          sourceVersionId,
          occurredAt: createdAt,
          sourceId: buildDraftCreatedSourceId(
            created.id,
            clone.metadata.version,
            clientCreationId,
          ),
        }),
      );

      return {
        workflowVersion: await this.getRequiredVersion(
          transaction,
          actorUserId,
          created.id,
        ),
        idempotent: false,
      };
    });
  }

  private transitionWithReadiness(
    actorUserId: string,
    workflowVersionId: string,
    expectedRevision: number,
    from: 'draft',
    to: 'testing',
  ): Promise<WorkflowLifecycleActionResult> {
    return this.runSerializable(async (transaction) => {
      const current = await this.getAccessibleVersion(
        transaction,
        actorUserId,
        workflowVersionId,
      );
      this.requireRole(current.access.role, EDITOR_ROLES);
      this.requireRevision(current.revision, expectedRevision);
      this.requireTransition(current.status, to);
      const readiness = await this.requireReadiness(
        transaction,
        current.workspaceId,
        current.definition,
      );

      const updated = await transaction.workflowVersion.updateMany({
        where: {
          id: workflowVersionId,
          status: from,
          revision: expectedRevision,
        },
        data: { status: to },
      });
      if (updated.count !== 1) {
        throw new WorkflowLifecycleRepositoryError(
          'WORKFLOW_VERSION_REVISION_CONFLICT',
        );
      }

      const finalVersion = await this.getRequiredVersion(
        transaction,
        actorUserId,
        workflowVersionId,
      );
      await appendAuditEventTransactional(
        transaction,
        this.auditTrail,
        buildWorkflowVersionTransitionInput({
          eventType: 'workflow_version.submitted_for_testing',
          occurredAt: new Date(),
          workspaceId: finalVersion.workspaceId,
          actor: { type: 'user', userId: actorUserId },
          version: finalVersion,
          sourceId: buildTransitionSourceId(
            'workflow_version.submitted_for_testing',
            finalVersion.id,
            finalVersion.revision,
          ),
        }),
      );

      return {
        workflowVersion: finalVersion,
        readiness,
        idempotent: false,
      };
    });
  }

  private async getAccessibleVersion(
    transaction: Prisma.TransactionClient,
    actorUserId: string,
    workflowVersionId: string,
  ): Promise<WorkflowVersionDetailRecord> {
    if (
      !UUID_PATTERN.test(actorUserId) ||
      !UUID_PATTERN.test(workflowVersionId)
    ) {
      throw new WorkflowLifecycleRepositoryError('INVALID_LIFECYCLE_INPUT');
    }
    const row = await transaction.workflowVersion.findFirst({
      where: {
        id: workflowVersionId,
        workflow: {
          workspace: {
            organization: {
              members: { some: { userId: actorUserId } },
            },
          },
        },
      },
      select: createDetailSelect(actorUserId),
    });
    if (row === null) {
      throw new WorkflowLifecycleRepositoryError('WORKFLOW_VERSION_NOT_FOUND');
    }
    return toDetailRecord(row, actorUserId);
  }

  private getRequiredVersion(
    transaction: Prisma.TransactionClient,
    actorUserId: string,
    workflowVersionId: string,
  ): Promise<WorkflowVersionDetailRecord> {
    return this.getAccessibleVersion(
      transaction,
      actorUserId,
      workflowVersionId,
    );
  }

  private requireRole(
    role: OrganizationRole,
    allowed: readonly OrganizationRole[],
  ): void {
    if (!hasRole(role, allowed)) {
      throw new WorkflowLifecycleRepositoryError(
        'WORKFLOW_LIFECYCLE_FORBIDDEN',
      );
    }
  }

  private requireTransition(
    from: WorkflowVersionDetailRecord['status'],
    to: WorkflowVersionDetailRecord['status'],
  ): void {
    if (!validateWorkflowLifecycleTransition(from, to).ok) {
      throw new WorkflowLifecycleRepositoryError(
        'INVALID_LIFECYCLE_TRANSITION',
      );
    }
  }

  private requireRevision(current: number, expected: number): void {
    if (!Number.isInteger(expected) || expected < 1) {
      throw new WorkflowLifecycleRepositoryError('INVALID_LIFECYCLE_INPUT');
    }
    if (current !== expected) {
      throw new WorkflowLifecycleRepositoryError(
        'WORKFLOW_VERSION_REVISION_CONFLICT',
        { currentRevision: current },
      );
    }
  }

  private async requireReadiness(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    definition: unknown,
  ): Promise<PublishReadinessReport> {
    const readiness = await this.analyzeReadiness(
      transaction,
      workspaceId,
      definition,
    );
    if (!readiness.ready) {
      throw new WorkflowLifecycleRepositoryError(
        'WORKFLOW_PUBLISH_READINESS_BLOCKED',
        { readiness },
      );
    }
    return readiness;
  }

  private async analyzeReadiness(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    definition: unknown,
  ): Promise<PublishReadinessReport> {
    const storedPolicy =
      await transaction.workspaceExecutionPolicyVersion.findFirst({
        where: { workspaceId, status: 'ACTIVE' },
        select: { definition: true },
      });
    const parsedPolicy = WorkspaceExecutionPolicyDefinitionSchema.safeParse(
      storedPolicy?.definition,
    );
    if (!parsedPolicy.success) {
      throw new WorkflowLifecycleRepositoryError('PERSISTED_WORKFLOW_INVALID');
    }
    return analyzePublishReadiness(
      definition,
      parsedPolicy.data satisfies WorkspaceExecutionPolicyDefinition,
    );
  }

  private requireTimestamp(timestamp: Date): void {
    if (!Number.isFinite(timestamp.getTime())) {
      throw new WorkflowLifecycleRepositoryError('INVALID_LIFECYCLE_INPUT');
    }
  }

  private async lockWorkflow(
    transaction: Prisma.TransactionClient,
    workflowId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "workflows"
      WHERE "id" = ${workflowId}
      FOR UPDATE
    `;
    if (rows.length !== 1) {
      throw new WorkflowLifecycleRepositoryError('WORKFLOW_NOT_FOUND');
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
        if (!isSerializationConflict(error)) {
          throw error;
        }
        if (attempt === MAX_SERIALIZABLE_ATTEMPTS) {
          throw new WorkflowLifecycleRepositoryError('SERIALIZATION_FAILURE');
        }
      }
    }

    throw new WorkflowLifecycleRepositoryError('SERIALIZATION_FAILURE');
  }
}
