import {
  canonicalizePolicyDefinition,
  WorkspaceExecutionPolicyDefinitionSchema,
  type WorkspaceExecutionPolicyDefinition,
} from '@tasktwin/workflow-policy';

import {
  OrganizationRole,
  Prisma,
  WorkspaceExecutionPolicyStatus,
  type PrismaClient,
} from '../generated/prisma/client.js';
import { createCanonicalJsonDigest } from '../recording/canonical-json.js';
import { ExecutionPolicyRepositoryError } from './execution-policy-errors.js';
import type {
  ExecutionPolicyVersionListRecord,
  ExecutionPolicyVersionRecord,
  WorkspaceExecutionPolicyRecord,
} from './execution-policy-records.js';

const WRITER_ROLES = [OrganizationRole.OWNER, OrganizationRole.ADMIN] as const;
const SERIALIZATION_RETRY_COUNT = 3;

function toRecord(row: {
  id: string;
  workspaceId: string;
  revision: number;
  status: WorkspaceExecutionPolicyStatus;
  definition: Prisma.JsonValue;
  digest: string;
  clientVersionId: string;
  createdByUserId: string;
  activatedAt: Date;
  archivedAt: Date | null;
  createdAt: Date;
}): ExecutionPolicyVersionRecord {
  return {
    ...row,
    status: row.status,
    definition: WorkspaceExecutionPolicyDefinitionSchema.parse(row.definition),
  };
}

function serializationError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2034' || error.code === 'P2028')
  );
}

export class ExecutionPolicyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getActive(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceExecutionPolicyRecord> {
    const access = await this.workspaceAccess(this.prisma, userId, workspaceId);
    if (access === null) {
      throw new ExecutionPolicyRepositoryError('POLICY_NOT_FOUND');
    }
    const active = await this.prisma.workspaceExecutionPolicyVersion.findFirst({
      where: { workspaceId, status: WorkspaceExecutionPolicyStatus.ACTIVE },
    });
    if (active === null) {
      throw new ExecutionPolicyRepositoryError('POLICY_MISSING');
    }
    return { ...access, active: toRecord(active) };
  }

  async listVersions(
    userId: string,
    workspaceId: string,
  ): Promise<ExecutionPolicyVersionListRecord> {
    const access = await this.workspaceAccess(this.prisma, userId, workspaceId);
    if (access === null) {
      throw new ExecutionPolicyRepositoryError('POLICY_NOT_FOUND');
    }
    const versions = await this.prisma.workspaceExecutionPolicyVersion.findMany({
      where: { workspaceId },
      orderBy: [{ revision: 'desc' }, { id: 'asc' }],
    });
    if (versions.length === 0) {
      throw new ExecutionPolicyRepositoryError('POLICY_MISSING');
    }
    return { ...access, versions: versions.map(toRecord) };
  }

  createVersion(input: {
    userId: string;
    workspaceId: string;
    clientVersionId: string;
    expectedActiveRevision: number;
    definition: WorkspaceExecutionPolicyDefinition;
    now: Date;
  }): Promise<{ record: WorkspaceExecutionPolicyRecord; idempotent: boolean }> {
    let definition: WorkspaceExecutionPolicyDefinition;
    try {
      definition = canonicalizePolicyDefinition(input.definition);
    } catch {
      throw new ExecutionPolicyRepositoryError('POLICY_INVALID');
    }
    const digest = createCanonicalJsonDigest(definition);
    return this.serializable(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "workspaces" WHERE "id" = ${input.workspaceId}::uuid FOR UPDATE`;
      const access = await this.workspaceAccess(
        transaction,
        input.userId,
        input.workspaceId,
      );
      if (access === null) {
        throw new ExecutionPolicyRepositoryError('POLICY_NOT_FOUND');
      }
      if (!WRITER_ROLES.includes(access.role as (typeof WRITER_ROLES)[number])) {
        throw new ExecutionPolicyRepositoryError('POLICY_FORBIDDEN');
      }
      const existing =
        await transaction.workspaceExecutionPolicyVersion.findUnique({
          where: {
            workspaceId_clientVersionId: {
              workspaceId: input.workspaceId,
              clientVersionId: input.clientVersionId,
            },
          },
        });
      if (existing !== null) {
        if (
          existing.digest !== digest ||
          existing.revision !== input.expectedActiveRevision + 1
        ) {
          throw new ExecutionPolicyRepositoryError('POLICY_VERSION_CONFLICT');
        }
        return {
          idempotent: true,
          record: { ...access, active: toRecord(existing) },
        };
      }
      const active =
        await transaction.workspaceExecutionPolicyVersion.findFirst({
          where: {
            workspaceId: input.workspaceId,
            status: WorkspaceExecutionPolicyStatus.ACTIVE,
          },
        });
      if (active === null) {
        throw new ExecutionPolicyRepositoryError('POLICY_MISSING');
      }
      if (active.revision !== input.expectedActiveRevision) {
        throw new ExecutionPolicyRepositoryError(
          'POLICY_REVISION_CONFLICT',
          active.revision,
        );
      }
      await transaction.workspaceExecutionPolicyVersion.update({
        where: { id: active.id },
        data: {
          status: WorkspaceExecutionPolicyStatus.ARCHIVED,
          archivedAt: input.now,
        },
      });
      const created = await transaction.workspaceExecutionPolicyVersion.create({
        data: {
          workspaceId: input.workspaceId,
          revision: active.revision + 1,
          status: WorkspaceExecutionPolicyStatus.ACTIVE,
          schemaVersion: 1,
          definition: definition as Prisma.InputJsonValue,
          digest,
          clientVersionId: input.clientVersionId,
          createdByUserId: input.userId,
          activatedAt: input.now,
        },
      });
      return {
        idempotent: false,
        record: { ...access, active: toRecord(created) },
      };
    });
  }

  private async workspaceAccess(
    client: PrismaClient | Prisma.TransactionClient,
    userId: string,
    workspaceId: string,
  ): Promise<{
    workspaceId: string;
    organizationId: string;
    role: OrganizationRole;
  } | null> {
    const row = await client.workspace.findFirst({
      where: {
        id: workspaceId,
        organization: { members: { some: { userId } } },
      },
      select: {
        id: true,
        organizationId: true,
        organization: {
          select: {
            members: {
              where: { userId },
              select: { role: true },
              take: 1,
            },
          },
        },
      },
    });
    const role = row?.organization.members[0]?.role;
    return row === null || row === undefined || role === undefined
      ? null
      : { workspaceId: row.id, organizationId: row.organizationId, role };
  }

  private async serializable<Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
  ): Promise<Result> {
    for (let attempt = 0; attempt < SERIALIZATION_RETRY_COUNT; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error: unknown) {
        if (!serializationError(error) || attempt === SERIALIZATION_RETRY_COUNT - 1) {
          if (serializationError(error)) {
            throw new ExecutionPolicyRepositoryError(
              'POLICY_SERIALIZATION_FAILURE',
            );
          }
          throw error;
        }
      }
    }
    throw new ExecutionPolicyRepositoryError('POLICY_SERIALIZATION_FAILURE');
  }
}
