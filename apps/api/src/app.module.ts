import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module.js';
import { AuthorizationModule } from './authorization/authorization.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { HealthService } from './health/health.service.js';
import { RecordingSessionsModule } from './recording-sessions/recording-sessions.module.js';
import { RecordingWorkflowDraftsModule } from './recording-workflow-drafts/recording-workflow-drafts.module.js';
import { RunnerPairingModule } from './runner-pairing/runner-pairing.module.js';
import { RunnerModule } from './runner/runner.module.js';
import { WorkspacesModule } from './workspaces/workspaces.module.js';
import { WorkflowLifecycleModule } from './workflow-lifecycle/workflow-lifecycle.module.js';
import { WorkflowsModule } from './workflows/workflows.module.js';
import { WorkflowRunsModule } from './workflow-runs/workflow-runs.module.js';
import { ExecutionPolicyModule } from './execution-policy/execution-policy.module.js';
import { AuditTrailModule } from './audit-trail/audit-trail.module.js';
import { WorkflowScheduleModule } from './workflow-schedule/workflow-schedule.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { OperationalTelemetryModule } from './operational-telemetry/operational-telemetry.module.js';
import { OperationsModule } from './operations/operations.module.js';
import { RunnerReleaseModule } from './runner-release/runner-release.module.js';
import { RunnerRolloutModule } from './runner-rollout/runner-rollout.module.js';
import { HttpSecurityModule } from './http-security/http-security.module.js';

@Module({
  imports: [
    AuthModule,
    AuthorizationModule,
    DatabaseModule,
    RecordingSessionsModule,
    RecordingWorkflowDraftsModule,
    RunnerPairingModule,
    RunnerModule,
    WorkspacesModule,
    WorkflowLifecycleModule,
    WorkflowsModule,
    WorkflowRunsModule,
    ExecutionPolicyModule,
    AuditTrailModule,
    WorkflowScheduleModule,
    NotificationsModule,
    OperationalTelemetryModule,
    OperationsModule,
    RunnerReleaseModule,
    RunnerRolloutModule,
    HttpSecurityModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
