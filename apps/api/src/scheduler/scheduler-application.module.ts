import { Module } from '@nestjs/common';

import { SchedulerModule } from './scheduler.module.js';

@Module({ imports: [SchedulerModule] })
export class SchedulerApplicationModule {}
