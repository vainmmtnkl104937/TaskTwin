import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { RunnerAuthModule } from '../runner-auth/runner-auth.module.js';
import { RunnerPairingModule } from '../runner-pairing/runner-pairing.module.js';
import { RunnerJobLeaseCryptoService } from '../runner-jobs/runner-job-lease-crypto.service.js';
import { RunnerJobLeaseGuard } from '../runner-jobs/runner-job-lease.guard.js';
import { RunnerJobsController } from '../runner-jobs/runner-jobs.controller.js';
import { RunnerJobsService } from '../runner-jobs/runner-jobs.service.js';
import { WorkflowRunsController } from './workflow-runs.controller.js';
import { WorkflowRunsService } from './workflow-runs.service.js';
import { WorkflowApprovalsController } from '../workflow-approvals/workflow-approvals.controller.js';
import { WorkflowApprovalsService } from '../workflow-approvals/workflow-approvals.service.js';
import { WorkflowRepairsController } from '../workflow-repairs/workflow-repairs.controller.js';
import { WorkflowRepairsService } from '../workflow-repairs/workflow-repairs.service.js';

@Module({
  imports: [
    AuthModule,
    AuthorizationModule,
    DatabaseModule,
    RunnerAuthModule,
    RunnerPairingModule,
  ],
  controllers: [
    WorkflowRunsController,
    RunnerJobsController,
    WorkflowApprovalsController,
    WorkflowRepairsController,
  ],
  providers: [
    WorkflowRunsService,
    RunnerJobsService,
    RunnerJobLeaseCryptoService,
    RunnerJobLeaseGuard,
    WorkflowApprovalsService,
    WorkflowRepairsService,
  ],
})
export class WorkflowRunsModule {}
