import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { configureApplication } from './config/configure-application.js';
import {
  getApiHost,
  getApiLogLevels,
  getApiPort,
  loadRootEnvironment,
  validateApiEnvironment,
} from './config/environment.js';

async function bootstrap(): Promise<void> {
  loadRootEnvironment();
  validateApiEnvironment();

  const app = await NestFactory.create(AppModule, {
    logger: getApiLogLevels(),
  });
  app.enableShutdownHooks();
  configureApplication(app);
  await app.listen(getApiPort(), getApiHost());
}

void bootstrap().catch(() => {
  console.error('API_STARTUP_FAILED');
  process.exitCode = 1;
});
