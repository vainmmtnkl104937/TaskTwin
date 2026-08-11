import { NestFactory } from '@nestjs/core';

import {
  getApiLogLevels,
  loadRootEnvironment,
  validateSchedulerEnvironment,
} from '../config/environment.js';
import { SchedulerApplicationModule } from './scheduler-application.module.js';

async function bootstrap(): Promise<void> {
  loadRootEnvironment();
  validateSchedulerEnvironment();
  const application = await NestFactory.createApplicationContext(
    SchedulerApplicationModule,
    { logger: getApiLogLevels() },
  );
  application.enableShutdownHooks();
}

void bootstrap().catch(() => {
  console.error('SCHEDULER_STARTUP_FAILED');
  process.exitCode = 1;
});
