import { Module } from '@nestjs/common';
import {
  createDatabaseClient,
  getRequiredDatabaseUrl,
} from '@tasktwin/database';

import { DATABASE_CLIENT } from './database.constants.js';
import { DatabaseHealthController } from './database-health.controller.js';
import { DatabaseHealthService } from './database-health.service.js';
import { PrismaService } from './prisma.service.js';

@Module({
  controllers: [DatabaseHealthController],
  providers: [
    {
      provide: DATABASE_CLIENT,
      useFactory: () => createDatabaseClient(getRequiredDatabaseUrl()),
    },
    PrismaService,
    DatabaseHealthService,
  ],
})
export class DatabaseModule {}
