import { Module } from '@nestjs/common';

import { AuthorizationModule } from '../authorization/authorization.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { WorkflowScheduleController } from './workflow-schedule.controller.js';
import { WorkflowScheduleService } from './workflow-schedule.service.js';

@Module({
  imports: [DatabaseModule, AuthorizationModule],
  controllers: [WorkflowScheduleController],
  providers: [WorkflowScheduleService],
  exports: [WorkflowScheduleService],
})
export class WorkflowScheduleModule {}
