import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { ExecutionPolicyController } from './execution-policy.controller.js';
import { ExecutionPolicyService } from './execution-policy.service.js';

@Module({
  imports: [AuthModule, DatabaseModule, AuthorizationModule],
  controllers: [ExecutionPolicyController],
  providers: [ExecutionPolicyService],
  exports: [ExecutionPolicyService],
})
export class ExecutionPolicyModule {}
