import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { OrganizationResourceContextGuard } from './organization-resource-context.guard.js';
import { OrganizationRoleGuard } from './organization-role.guard.js';
import { SystemAdministratorGuard } from './system-administrator.guard.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    OrganizationResourceContextGuard,
    OrganizationRoleGuard,
    SystemAdministratorGuard,
  ],
  exports: [
    OrganizationResourceContextGuard,
    OrganizationRoleGuard,
    SystemAdministratorGuard,
  ],
})
export class AuthorizationModule {}
