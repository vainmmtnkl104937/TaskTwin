import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { RunnerRolloutController } from './runner-rollout.controller.js';
import { RunnerRolloutService } from './runner-rollout.service.js';

@Module({
  imports: [AuthModule, AuthorizationModule, DatabaseModule],
  controllers: [RunnerRolloutController],
  providers: [RunnerRolloutService],
})
export class RunnerRolloutModule {}
