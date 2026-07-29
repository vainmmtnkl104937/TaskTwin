import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { RecordingSessionsController } from './recording-sessions.controller.js';
import { RecordingSessionsService } from './recording-sessions.service.js';

@Module({
  imports: [AuthModule, AuthorizationModule, DatabaseModule],
  controllers: [RecordingSessionsController],
  providers: [RecordingSessionsService],
})
export class RecordingSessionsModule {}
