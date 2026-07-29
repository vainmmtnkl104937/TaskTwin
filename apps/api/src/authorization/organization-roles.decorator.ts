import { SetMetadata } from '@nestjs/common';
import type { OrganizationRole } from '@tasktwin/database';

export const ORGANIZATION_ROLES_METADATA = 'tasktwin:organization-roles';

export const RequireOrganizationRoles = (
  ...roles: OrganizationRole[]
): MethodDecorator & ClassDecorator =>
  SetMetadata(ORGANIZATION_ROLES_METADATA, roles);
