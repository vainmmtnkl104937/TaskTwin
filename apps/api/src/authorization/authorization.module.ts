import { Module } from '@nestjs/common';

import { OrganizationRoleGuard } from './organization-role.guard.js';

@Module({
  providers: [OrganizationRoleGuard],
  exports: [OrganizationRoleGuard],
})
export class AuthorizationModule {}
