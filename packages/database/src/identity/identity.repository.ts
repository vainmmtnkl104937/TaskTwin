import {
  canonicalizePolicyDefinition,
  DEFAULT_WORKSPACE_EXECUTION_POLICY,
} from '@tasktwin/workflow-policy';

import type { PrismaClient } from '../generated/prisma/client.js';
import { OrganizationRole, Prisma } from '../generated/prisma/client.js';
import { createCanonicalJsonDigest } from '../recording/canonical-json.js';
import { DuplicateEmailError } from './identity-errors.js';
import type {
  AuthenticationUserRecord,
  CreateRegistrationInput,
  CreateRegistrationResult,
  SafeUserRecord,
  WorkspaceAccessRecord,
} from './identity-records.js';

const safeUserSelect = {
  id: true,
  email: true,
  displayName: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

const authenticationUserSelect = {
  ...safeUserSelect,
  passwordHash: true,
} as const;

const organizationSelect = {
  id: true,
  name: true,
  slug: true,
  createdAt: true,
  updatedAt: true,
} as const;

const membershipSelect = {
  userId: true,
  organizationId: true,
  role: true,
  createdAt: true,
  updatedAt: true,
} as const;

const workspaceSelect = {
  id: true,
  organizationId: true,
  name: true,
  slug: true,
  createdAt: true,
  updatedAt: true,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isEmailUniqueConstraintError(error: unknown): boolean {
  if (!isRecord(error) || error.code !== 'P2002') {
    return false;
  }

  const metadata = error.meta;
  if (!isRecord(metadata)) {
    return false;
  }

  // Prisma's driver-adapter error shape does not always expose `target`.
  // Email is currently the only unique field on User.
  if (metadata.modelName === 'User') {
    return true;
  }

  const target = metadata.target;
  if (typeof target === 'string') {
    return target.toLowerCase().includes('email');
  }

  return (
    Array.isArray(target) &&
    target.some(
      (field) =>
        typeof field === 'string' && field.toLowerCase().includes('email'),
    )
  );
}

export class IdentityRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findAuthenticationUserByEmail(
    normalizedEmail: string,
  ): Promise<AuthenticationUserRecord | null> {
    return this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: authenticationUserSelect,
    });
  }

  findSafeUserById(userId: string): Promise<SafeUserRecord | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: safeUserSelect,
    });
  }

  async listReachableWorkspaces(
    userId: string,
  ): Promise<WorkspaceAccessRecord[]> {
    const rows = await this.prisma.workspace.findMany({
      where: {
        organization: {
          members: {
            some: { userId },
          },
        },
      },
      select: {
        ...workspaceSelect,
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
      orderBy: [{ organizationId: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    });
    return rows.flatMap((row) => {
      const membership = row.organization.members[0];
      return membership === undefined
        ? []
        : [
            {
              id: row.id,
              organizationId: row.organizationId,
              name: row.name,
              slug: row.slug,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
              role: membership.role,
            },
          ];
    });
  }

  async createRegistration(
    input: CreateRegistrationInput,
  ): Promise<CreateRegistrationResult> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            id: input.userId,
            email: input.normalizedEmail,
            passwordHash: input.passwordHash,
            displayName: input.displayName,
          },
          select: safeUserSelect,
        });
        const organization = await transaction.organization.create({
          data: {
            id: input.organizationId,
            name: input.organizationName,
            slug: input.organizationSlug,
          },
          select: organizationSelect,
        });
        const membership = await transaction.organizationMember.create({
          data: {
            userId: user.id,
            organizationId: organization.id,
            role: OrganizationRole.OWNER,
          },
          select: membershipSelect,
        });
        const workspace = await transaction.workspace.create({
          data: {
            id: input.workspaceId,
            organizationId: organization.id,
            name: input.workspaceName,
            slug: input.workspaceSlug,
          },
          select: workspaceSelect,
        });
        const defaultPolicy = canonicalizePolicyDefinition(
          DEFAULT_WORKSPACE_EXECUTION_POLICY,
        );
        await transaction.workspaceExecutionPolicyVersion.create({
          data: {
            workspaceId: workspace.id,
            revision: 1,
            schemaVersion: 1,
            definition: defaultPolicy as Prisma.InputJsonValue,
            digest: createCanonicalJsonDigest(defaultPolicy),
            clientVersionId: '00000000-0000-4000-8000-000000000024',
            createdByUserId: user.id,
          },
        });

        return { user, organization, membership, workspace };
      });
    } catch (error: unknown) {
      if (isEmailUniqueConstraintError(error)) {
        throw new DuplicateEmailError();
      }

      throw error;
    }
  }
}
