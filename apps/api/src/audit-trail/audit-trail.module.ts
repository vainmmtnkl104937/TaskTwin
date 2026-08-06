import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { AuditTrailController } from './audit-trail.controller.js';
import { AuditTrailService } from './audit-trail.service.js';
import { AuditTrailIntegration } from './integration.js';

@Module({
  imports: [AuthModule, AuthorizationModule, DatabaseModule],
  controllers: [AuditTrailController],
  providers: [AuditTrailService, AuditTrailIntegration],
  exports: [AuditTrailService],
})
export class AuditTrailModule {}