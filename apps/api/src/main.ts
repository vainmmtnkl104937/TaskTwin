import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';

const DEFAULT_API_PORT = 3001;

function getApiPort(): number {
  const configuredPort = process.env.API_PORT;

  if (configuredPort === undefined) {
    return DEFAULT_API_PORT;
  }

  const parsedPort = Number(configuredPort);

  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    throw new Error('API_PORT must be an integer between 1 and 65535');
  }

  return parsedPort;
}

async function bootstrap(): Promise<void> {
  const rootEnvironmentPath = fileURLToPath(
    new URL('../../../.env', import.meta.url),
  );

  if (existsSync(rootEnvironmentPath)) {
    process.loadEnvFile(rootEnvironmentPath);
  }

  const app = await NestFactory.create(AppModule);
  await app.listen(getApiPort());
}

void bootstrap();
