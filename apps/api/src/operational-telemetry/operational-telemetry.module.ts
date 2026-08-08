import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { ApiHeartbeatService } from './api-heartbeat.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [ApiHeartbeatService],
})
export class OperationalTelemetryModule {}
