import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { configureApplication } from './config/configure-application.js';
import { getApiPort, loadRootEnvironment } from './config/environment.js';

async function bootstrap(): Promise<void> {
  loadRootEnvironment();

  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  configureApplication(app);
  await app.listen(getApiPort());
}

void bootstrap();
