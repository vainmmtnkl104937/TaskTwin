import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { configureApplication } from './config/configure-application.js';
import {
  getApiHost,
  getApiLogLevels,
  getApiPort,
  loadRootEnvironment,
  validateApiEnvironment,
  getHttpSecurityConfiguration,
} from './config/environment.js';
import { RedactingLogger } from './http-security/redacting-logger.service.js';
import type { Server } from 'node:http';

async function bootstrap(): Promise<void> {
  loadRootEnvironment();
  validateApiEnvironment();

  const logger = new RedactingLogger({ logLevels: getApiLogLevels() });
  const app = await NestFactory.create(AppModule, {
    logger,
    bodyParser: false,
    forceCloseConnections: true,
  });
  app.enableShutdownHooks();
  configureApplication(app);
  await app.listen(getApiPort(), getApiHost());
  const server = app.getHttpServer() as Server;
  const security = getHttpSecurityConfiguration();
  server.requestTimeout = security.requestTimeoutMs;
  server.headersTimeout = security.headersTimeoutMs;
  server.keepAliveTimeout = security.keepAliveTimeoutMs;
  server.maxHeadersCount = 100;
}

void bootstrap().catch(() => {
  console.error('API_STARTUP_FAILED');
  process.exitCode = 1;
});
