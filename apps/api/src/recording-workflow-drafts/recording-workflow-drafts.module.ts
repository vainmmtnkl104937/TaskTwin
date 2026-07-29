import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { RecordingWorkflowDraftsController } from './recording-workflow-drafts.controller.js';
import { RecordingWorkflowDraftsService } from './recording-workflow-drafts.service.js';

@Module({
  imports: [AuthModule, AuthorizationModule, DatabaseModule],
  controllers: [RecordingWorkflowDraftsController],
  providers: [RecordingWorkflowDraftsService],
})
export class RecordingWorkflowDraftsModule {}
