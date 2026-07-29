import { Module } from '@nestjs/common';
import {
  createDatabaseClient,
  getRequiredDatabaseUrl,
  IdentityRepository,
  RecordingRepository,
  RecordingWorkflowConversionRepository,
  WorkflowDraftRepository,
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
    {
      provide: RecordingRepository,
      inject: [DATABASE_CLIENT],
      useFactory: (client: PrismaClient) => new RecordingRepository(client),
    },
    {
      provide: RecordingWorkflowConversionRepository,
      inject: [DATABASE_CLIENT],
      useFactory: (client: PrismaClient) =>
        new RecordingWorkflowConversionRepository(client),
    },
    {
      provide: WorkflowDraftRepository,
      inject: [DATABASE_CLIENT],
      useFactory: (client: PrismaClient) => new WorkflowDraftRepository(client),
    },
  ],
  exports: [
    IdentityRepository,
    RecordingRepository,
    RecordingWorkflowConversionRepository,
    WorkflowDraftRepository,
  ],
})
export class DatabaseModule {}
