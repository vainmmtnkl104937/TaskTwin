import { randomUUID } from 'node:crypto';

import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  DuplicateEmailError,
  IdentityRepository,
  normalizeEmail,
} from '@tasktwin/database';

import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import {
  type LoginResponse,
  type RegisterResponse,
  type SafeUserResponse,
  toOrganizationResponse,
  toSafeUserResponse,
  toWorkspaceResponse,
} from './auth.types.js';
import { PasswordHasher } from './password-hasher.js';

const GENERIC_CREDENTIAL_ERROR = 'Invalid email or password';
const DEFAULT_WORKSPACE_NAME = 'Default Workspace';
const DEFAULT_WORKSPACE_SLUG = 'default';

function createOrganizationSlug(name: string, organizationId: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
    .replace(/-$/g, '');
  const safeBase = base === '' ? 'organization' : base;

  return `${safeBase}-${organizationId.slice(0, 8)}`;
}

@Injectable()
export class AuthService {
  private dummyPasswordHash: Promise<string> | undefined;

  constructor(
    private readonly identityRepository: IdentityRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly jwtService: JwtService,
  ) {}

  async register(input: RegisterDto): Promise<RegisterResponse> {
    const normalizedEmail = normalizeEmail(input.email);
    const passwordHash = await this.passwordHasher.hash(input.password);
    const organizationId = randomUUID();

    try {
      const result = await this.identityRepository.createRegistration({
        userId: randomUUID(),
        normalizedEmail,
        passwordHash,
        displayName: input.displayName,
        organizationId,
        organizationName: input.organizationName,
        organizationSlug: createOrganizationSlug(
          input.organizationName,
          organizationId,
        ),
        workspaceId: randomUUID(),
        workspaceName: DEFAULT_WORKSPACE_NAME,
        workspaceSlug: DEFAULT_WORKSPACE_SLUG,
      });

      return {
        user: toSafeUserResponse(result.user),
        organization: {
          ...toOrganizationResponse(result.organization),
          role: 'OWNER',
        },
        workspace: toWorkspaceResponse(result.workspace),
        accessToken: await this.signAccessToken(result.user.id),
      };
    } catch (error: unknown) {
      if (error instanceof DuplicateEmailError) {
        throw new ConflictException(
          'An account with this email already exists',
        );
      }

      throw error;
    }
  }

  async login(input: LoginDto): Promise<LoginResponse> {
    const user = await this.identityRepository.findAuthenticationUserByEmail(
      normalizeEmail(input.email),
    );
    const passwordMatches = await this.passwordHasher.verify(
      user?.passwordHash ?? (await this.getDummyPasswordHash()),
      input.password,
    );

    if (user === null || !passwordMatches || !user.isActive) {
      throw new UnauthorizedException(GENERIC_CREDENTIAL_ERROR);
    }

    return {
      user: toSafeUserResponse(user),
      accessToken: await this.signAccessToken(user.id),
    };
  }

  async getCurrentUser(userId: string): Promise<SafeUserResponse> {
    const user = await this.identityRepository.findSafeUserById(userId);
    if (user === null || !user.isActive) {
      throw new UnauthorizedException();
    }

    return toSafeUserResponse(user);
  }

  private signAccessToken(userId: string): Promise<string> {
    return this.jwtService.signAsync({ sub: userId });
  }

  private getDummyPasswordHash(): Promise<string> {
    this.dummyPasswordHash ??= this.passwordHasher.hash(randomUUID());
    return this.dummyPasswordHash;
  }
}
