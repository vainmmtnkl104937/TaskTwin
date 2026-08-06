import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { SchedulerService } from './scheduler.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
