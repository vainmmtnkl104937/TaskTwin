import type { OrganizationRole } from '../generated/prisma/client.js';

export interface SafeUserRecord {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  isSystemAdministrator: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthenticationUserRecord extends SafeUserRecord {
  passwordHash: string;
}

export interface OrganizationRecord {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationMembershipRecord {
  userId: string;
  organizationId: string;
  role: OrganizationRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceRecord {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceAccessRecord extends WorkspaceRecord {
  role: OrganizationRole;
}

export interface CreateRegistrationInput {
  userId: string;
  normalizedEmail: string;
  passwordHash: string;
  displayName: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
}

export interface CreateRegistrationResult {
  user: SafeUserRecord;
  organization: OrganizationRecord;
  membership: OrganizationMembershipRecord;
  workspace: WorkspaceRecord;
}
