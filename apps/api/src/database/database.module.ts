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
  WorkflowRepairRepository,
  WorkflowLocatorRepairRepository,
  ExecutionPolicyRepository,
  WorkflowScheduleRepository,
  WorkspaceAuditTrailRepository,
  type PrismaClient,
} from '@tasktwin/database';

import { DATABASE_CLIENT } from './database.constants.js';
import { DatabaseHealthController } from './database-health.controller.js';
import { DatabaseHealthService } from './database-health.service.js';
import { PrismaService } from './prisma.service.js';
import { OperationalAlertAppender } from '../operational-alerts/operational-alert.appender.js';

@Module({
  controllers: [DatabaseHealthController],
  providers: [
    {
      provide: DATABASE_CLIENT,
      useFactory: () => createDatabaseClient(getRequiredDatabaseUrl()),
    },
    PrismaService,
    DatabaseHealthService,
    OperationalAlertAppender,
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
      inject: [DATABASE_CLIENT, OperationalAlertAppender],
      useFactory: (client: PrismaClient, alerts: OperationalAlertAppender) =>
        new RunnerRepository(client, alerts),
    },
    {
      provide: WorkflowRunRepository,
      inject: [DATABASE_CLIENT, OperationalAlertAppender],
      useFactory: (client: PrismaClient, alerts: OperationalAlertAppender) =>
        new WorkflowRunRepository(client, undefined, alerts),
    },
    {
      provide: SecureRunInputRepository,
      inject: [DATABASE_CLIENT],
      useFactory: (client: PrismaClient) =>
        new SecureRunInputRepository(client),
    },
    {
      provide: WorkflowApprovalRepository,
      inject: [DATABASE_CLIENT, OperationalAlertAppender],
      useFactory: (client: PrismaClient, alerts: OperationalAlertAppender) =>
        new WorkflowApprovalRepository(client, undefined, alerts),
    },
    {
      provide: WorkflowRepairRepository,
      inject: [DATABASE_CLIENT, OperationalAlertAppender],
      useFactory: (client: PrismaClient, alerts: OperationalAlertAppender) =>
        new WorkflowRepairRepository(client, undefined, alerts),
    },
    {
      provide: WorkflowLocatorRepairRepository,
      inject: [DATABASE_CLIENT],
      useFactory: (client: PrismaClient) =>
        new WorkflowLocatorRepairRepository(client),
    },
    {
      provide: ExecutionPolicyRepository,
      inject: [DATABASE_CLIENT],
      useFactory: (client: PrismaClient) =>
        new ExecutionPolicyRepository(client),
    },
    {
      provide: WorkflowScheduleRepository,
      inject: [DATABASE_CLIENT, OperationalAlertAppender],
      useFactory: (client: PrismaClient, alerts: OperationalAlertAppender) =>
        new WorkflowScheduleRepository(client, undefined, alerts),
    },
    {
      provide: WorkspaceAuditTrailRepository,
      inject: [DATABASE_CLIENT],
      useFactory: (client: PrismaClient) =>
        new WorkspaceAuditTrailRepository(client),
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
    WorkflowRepairRepository,
    WorkflowLocatorRepairRepository,
    ExecutionPolicyRepository,
    WorkflowScheduleRepository,
    WorkspaceAuditTrailRepository,
    OperationalAlertAppender,
  ],
})
export class DatabaseModule {}
