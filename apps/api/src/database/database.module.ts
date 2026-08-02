import { Module } from '@nestjs/common';
import {
  createDatabaseClient,
  getRequiredDatabaseUrl,
  IdentityRepository,
  RecordingRepository,
  RecordingWorkflowConversionRepository,
  RunnerRepository,
  SecureRunInputRepository,
  WorkflowDraftRepository,
  WorkflowLifecycleRepository,
  WorkflowRunRepository,
  WorkflowApprovalRepository,
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
    {
      provide: WorkflowLifecycleRepository,
      inject: [DATABASE_CLIENT],
      useFactory: (client: PrismaClient) =>
        new WorkflowLifecycleRepository(client),
    },
    {
      provide: RunnerRepository,
      inject: [DATABASE_CLIENT],
      useFactory: (client: PrismaClient) => new RunnerRepository(client),
    },
    {
      provide: WorkflowRunRepository,
      inject: [DATABASE_CLIENT],
      useFactory: (client: PrismaClient) => new WorkflowRunRepository(client),
    },
    {
      provide: SecureRunInputRepository,
      inject: [DATABASE_CLIENT],
      useFactory: (client: PrismaClient) =>
        new SecureRunInputRepository(client),
    },
    {
      provide: WorkflowApprovalRepository,
      inject: [DATABASE_CLIENT],
      useFactory: (client: PrismaClient) =>
        new WorkflowApprovalRepository(client),
    },
  ],
  exports: [
    IdentityRepository,
    RecordingRepository,
    RecordingWorkflowConversionRepository,
    WorkflowDraftRepository,
    WorkflowLifecycleRepository,
    RunnerRepository,
    WorkflowRunRepository,
    SecureRunInputRepository,
    WorkflowApprovalRepository,
  ],
})
export class DatabaseModule {}
