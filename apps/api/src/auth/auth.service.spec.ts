import { ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  DuplicateEmailError,
  IdentityRepository,
  OrganizationRole,
  type AuthenticationUserRecord,
} from '@tasktwin/database';
import { describe, expect, it, vi } from 'vitest';

import { AuthService } from './auth.service.js';
import { PasswordHasher } from './password-hasher.js';

const timestamp = new Date('2026-07-29T00:00:00.000Z');
const authenticationUser: AuthenticationUserRecord = {
  id: '2cadb682-9315-4ca2-b63e-3955f937c81f',
  email: 'owner@example.com',
  passwordHash: '$argon2id$test',
  displayName: 'Owner',
  isActive: true,
  isSystemAdministrator: false,
  createdAt: timestamp,
  updatedAt: timestamp,
};

function createService(overrides?: {
  identityRepository?: Partial<IdentityRepository>;
  passwordHasher?: Partial<PasswordHasher>;
}) {
  const identityRepository = {
    createRegistration: vi.fn(),
    findAuthenticationUserByEmail: vi.fn(),
    findSafeUserById: vi.fn(),
    ...overrides?.identityRepository,
  } as unknown as IdentityRepository;
  const passwordHasher = {
    hash: vi.fn().mockResolvedValue('$argon2id$test'),
    verify: vi.fn().mockResolvedValue(true),
    ...overrides?.passwordHasher,
  } as unknown as PasswordHasher;
  const jwtService = {
    signAsync: vi.fn().mockResolvedValue('signed-access-token'),
  } as unknown as JwtService;

  return {
    service: new AuthService(identityRepository, passwordHasher, jwtService),
    identityRepository,
    passwordHasher,
    jwtService,
  };
}

describe('AuthService', () => {
  it('normalizes email and returns an explicit safe registration response', async () => {
    const registration = {
      user: {
        id: authenticationUser.id,
        email: authenticationUser.email,
        displayName: authenticationUser.displayName,
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      organization: {
        id: 'cc442e03-9854-48a8-bd0a-81931913bea7',
        name: 'Acme',
        slug: 'acme-cc442e03',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      membership: {
        userId: authenticationUser.id,
        organizationId: 'cc442e03-9854-48a8-bd0a-81931913bea7',
        role: OrganizationRole.OWNER,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      workspace: {
        id: '4e97f276-af40-488d-be6b-c8864cfe4db4',
        organizationId: 'cc442e03-9854-48a8-bd0a-81931913bea7',
        name: 'Default Workspace',
        slug: 'default',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    };
    const createRegistration = vi.fn().mockResolvedValue(registration);
    const { service } = createService({
      identityRepository: { createRegistration },
    });

    const response = await service.register({
      email: ' Owner@Example.COM ',
      password: 'a sufficiently long password',
      displayName: 'Owner',
      organizationName: 'Acme',
    });

    expect(createRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizedEmail: 'owner@example.com',
        passwordHash: '$argon2id$test',
        workspaceName: 'Default Workspace',
        workspaceSlug: 'default',
      }),
    );
    expect(response.organization.role).toBe('OWNER');
    expect(response.accessToken).toBe('signed-access-token');
    expect(response.user).not.toHaveProperty('passwordHash');
    expect(response).not.toHaveProperty('password');
  });

  it('returns a conflict for a duplicate normalized email', async () => {
    const { service } = createService({
      identityRepository: {
        createRegistration: vi
          .fn()
          .mockRejectedValue(new DuplicateEmailError()),
      },
    });

    await expect(
      service.register({
        email: 'owner@example.com',
        password: 'a sufficiently long password',
        displayName: 'Owner',
        organizationName: 'Acme',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('uses the generic credential error for an unknown user', async () => {
    const verify = vi.fn().mockResolvedValue(false);
    const { service } = createService({
      identityRepository: {
        findAuthenticationUserByEmail: vi.fn().mockResolvedValue(null),
      },
      passwordHasher: { verify },
    });

    await expect(
      service.login({
        email: 'missing@example.com',
        password: 'wrong password',
      }),
    ).rejects.toMatchObject({
      message: 'Invalid email or password',
    });
    expect(verify).toHaveBeenCalledOnce();
  });

  it('uses the same generic credential error for a wrong password', async () => {
    const { service } = createService({
      identityRepository: {
        findAuthenticationUserByEmail: vi
          .fn()
          .mockResolvedValue(authenticationUser),
      },
      passwordHasher: { verify: vi.fn().mockResolvedValue(false) },
    });

    await expect(
      service.login({
        email: authenticationUser.email,
        password: 'wrong password',
      }),
    ).rejects.toMatchObject({
      message: 'Invalid email or password',
    });
  });

  it('signs only the immutable user identifier into the application payload', async () => {
    const { service, jwtService } = createService({
      identityRepository: {
        findAuthenticationUserByEmail: vi
          .fn()
          .mockResolvedValue(authenticationUser),
      },
    });

    const response = await service.login({
      email: authenticationUser.email,
      password: 'correct password',
    });

    expect(jwtService.signAsync).toHaveBeenCalledWith({
      sub: authenticationUser.id,
    });
    expect(response.user).not.toHaveProperty('passwordHash');
  });

  it('rejects an inactive user with the generic credential error', async () => {
    const { service } = createService({
      identityRepository: {
        findAuthenticationUserByEmail: vi.fn().mockResolvedValue({
          ...authenticationUser,
          isActive: false,
        }),
      },
    });

    await expect(
      service.login({
        email: authenticationUser.email,
        password: 'correct password',
      }),
    ).rejects.toMatchObject({
      message: 'Invalid email or password',
    });
  });

  it('returns only safe current-user fields', async () => {
    const { service } = createService({
      identityRepository: {
        findSafeUserById: vi.fn().mockResolvedValue(authenticationUser),
      },
    });

    const user = await service.getCurrentUser(authenticationUser.id);

    expect(user).toEqual({
      id: authenticationUser.id,
      email: authenticationUser.email,
      displayName: authenticationUser.displayName,
      isActive: true,
      isSystemAdministrator: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    expect(user).not.toHaveProperty('passwordHash');
  });
});
