import type {
  OrganizationRecord,
  SafeUserRecord,
  WorkspaceRecord,
} from '@tasktwin/database';

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  isSystemAdministrator: boolean;
}

export interface JwtAccessPayload {
  sub: string;
}

export interface SafeUserResponse {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  isSystemAdministrator: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationResponse {
  id: string;
  name: string;
  slug: string;
  role: 'OWNER';
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceResponse {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
  canManageRunners: boolean;
}

export interface RegisterResponse {
  user: SafeUserResponse;
  organization: OrganizationResponse;
  workspace: WorkspaceResponse;
  accessToken: string;
}

export interface LoginResponse {
  user: SafeUserResponse;
  accessToken: string;
}

export function toSafeUserResponse(user: SafeUserRecord): SafeUserResponse {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    isActive: user.isActive,
    isSystemAdministrator: user.isSystemAdministrator,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function toAuthenticatedUser(user: SafeUserRecord): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    isSystemAdministrator: user.isSystemAdministrator,
  };
}

export function toOrganizationResponse(
  organization: OrganizationRecord,
): Omit<OrganizationResponse, 'role'> {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
  };
}

export function toWorkspaceResponse(
  workspace: WorkspaceRecord,
  role: WorkspaceResponse['role'],
): WorkspaceResponse {
  return {
    id: workspace.id,
    organizationId: workspace.organizationId,
    name: workspace.name,
    slug: workspace.slug,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    role,
    canManageRunners: role === 'OWNER' || role === 'ADMIN',
  };
}
