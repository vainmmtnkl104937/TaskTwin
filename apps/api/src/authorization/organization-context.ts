import type { OrganizationRole } from '@tasktwin/database';

export interface VerifiedOrganizationContext {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
}

export const VERIFIED_ORGANIZATION_CONTEXT = Symbol(
  'verified-organization-context',
);

export interface OrganizationContextRequest {
  [VERIFIED_ORGANIZATION_CONTEXT]?: VerifiedOrganizationContext;
}

export function attachVerifiedOrganizationContext(
  request: OrganizationContextRequest,
  context: VerifiedOrganizationContext,
): void {
  request[VERIFIED_ORGANIZATION_CONTEXT] = context;
}
