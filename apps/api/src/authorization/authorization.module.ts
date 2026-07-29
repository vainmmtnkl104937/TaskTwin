import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { OrganizationResourceContextGuard } from './organization-resource-context.guard.js';
import { OrganizationRoleGuard } from './organization-role.guard.js';

@Module({
  imports: [DatabaseModule],
  providers: [OrganizationResourceContextGuard, OrganizationRoleGuard],
  exports: [OrganizationResourceContextGuard, OrganizationRoleGuard],
})
export class AuthorizationModule {}
