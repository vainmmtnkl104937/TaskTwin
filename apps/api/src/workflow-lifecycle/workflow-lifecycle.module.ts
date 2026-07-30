import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { WorkflowLifecycleController } from './workflow-lifecycle.controller.js';
import { WorkflowLifecycleService } from './workflow-lifecycle.service.js';

@Module({
  imports: [AuthModule, AuthorizationModule, DatabaseModule],
  controllers: [WorkflowLifecycleController],
  providers: [WorkflowLifecycleService],
})
export class WorkflowLifecycleModule {}
