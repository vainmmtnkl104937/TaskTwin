import { describe, expect, it, vi } from 'vitest';

import {
  OrganizationRole,
  type Prisma,
  type PrismaClient,
} from '../src/generated/prisma/client.js';
import { IdentityRepository } from '../src/identity/identity.repository.js';
import { DuplicateEmailError } from '../src/identity/identity-errors.js';
import type { CreateRegistrationInput } from '../src/identity/identity-records.js';

const createdAt = new Date('2026-07-29T00:00:00.000Z');
const updatedAt = new Date('2026-07-29T00:00:00.000Z');
const input: CreateRegistrationInput = {
  userId: '74c2fef6-54cb-438d-b343-77e4cfd19806',
  normalizedEmail: 'owner@example.com',
  passwordHash: '$argon2id$not-a-real-test-hash',
  displayName: 'Owner',
  organizationId: '13375635-b896-4446-81ed-2de3fa201dac',
  organizationName: 'Example',
  organizationSlug: 'example-13375635',
  workspaceId: '74ef5779-b652-4dd2-88f8-2f88e1bbac71',
  workspaceName: 'Default Workspace',
  workspaceSlug: 'default',
};

describe('IdentityRepository', () => {
  it('creates the complete registration graph in one transaction', async () => {
    const user = {
      id: input.userId,
      email: input.normalizedEmail,
      displayName: input.displayName,
      isActive: true,
      createdAt,
      updatedAt,
    };
    const organization = {
      id: input.organizationId,
      name: input.organizationName,
      slug: input.organizationSlug,
      createdAt,
      updatedAt,
    };
    const membership = {
      userId: input.userId,
      organizationId: input.organizationId,
      role: OrganizationRole.OWNER,
      createdAt,
      updatedAt,
    };
    const workspace = {
      id: input.workspaceId,
      organizationId: input.organizationId,
      name: input.workspaceName,
      slug: input.workspaceSlug,
      createdAt,
      updatedAt,
    };
    const transactionClient = {
      user: { create: vi.fn().mockResolvedValue(user) },
      organization: { create: vi.fn().mockResolvedValue(organization) },
      organizationMember: {
        create: vi.fn().mockResolvedValue(membership),
      },
      workspace: { create: vi.fn().mockResolvedValue(workspace) },
      workspaceAuditChainHead: {
        create: vi.fn().mockResolvedValue({}),
      },
      workspaceExecutionPolicyVersion: {
        create: vi.fn().mockResolvedValue({}),
      },
    } as unknown as Prisma.TransactionClient;
    const transaction = vi
      .fn()
      .mockImplementation(
        async (
          operation: (client: Prisma.TransactionClient) => Promise<unknown>,
        ) => operation(transactionClient),
      );
    const repository = new IdentityRepository({
      $transaction: transaction,
    } as unknown as PrismaClient);

    await expect(repository.createRegistration(input)).resolves.toEqual({
      user,
      organization,
      membership,
      workspace,
    });
    expect(transaction).toHaveBeenCalledOnce();
    expect(
      transactionClient.workspaceAuditChainHead.create,
    ).toHaveBeenCalledWith({ data: { workspaceId: workspace.id } });
    expect(transactionClient.organizationMember.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: OrganizationRole.OWNER }),
      }),
    );
    expect(
      transactionClient.workspaceExecutionPolicyVersion.create,
    ).toHaveBeenCalledOnce();
  });

  it('scopes workspace reads through organization membership', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new IdentityRepository({
      workspace: { findMany },
    } as unknown as PrismaClient);

    await repository.listReachableWorkspaces(input.userId);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organization: {
            members: {
              some: { userId: input.userId },
            },
          },
        },
      }),
    );
  });

  it('maps the normalized email unique constraint to a domain error', async () => {
    const repository = new IdentityRepository({
      $transaction: vi.fn().mockRejectedValue({
        code: 'P2002',
        meta: {
          modelName: 'User',
          driverAdapterError: {
            cause: {
              constraint: { fields: ['email'] },
            },
          },
        },
      }),
    } as unknown as PrismaClient);

    await expect(repository.createRegistration(input)).rejects.toBeInstanceOf(
      DuplicateEmailError,
    );
  });
});
