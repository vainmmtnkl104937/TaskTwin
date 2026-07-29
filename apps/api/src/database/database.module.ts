import { Module } from '@nestjs/common';
import {
  createDatabaseClient,
  getRequiredDatabaseUrl,
  IdentityRepository,
  type PrismaClient,
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
    {
      provide: IdentityRepository,
      inject: [DATABASE_CLIENT],
      useFactory: (client: PrismaClient) => new IdentityRepository(client),
    },
  ],
  exports: [IdentityRepository],
})
export class DatabaseModule {}
