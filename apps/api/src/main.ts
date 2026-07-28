import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

const API_PORT = 3001;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  await app.listen(API_PORT);
}

void bootstrap();
