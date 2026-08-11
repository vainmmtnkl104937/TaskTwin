import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { RunnerReleaseController } from './runner-release.controller.js';
import {
  RUNNER_RELEASE_TRUSTED_KEYS,
  RunnerReleaseService,
} from './runner-release.service.js';
import { TRUSTED_RUNNER_RELEASE_KEYS } from '@tasktwin/runner-release';

@Module({
  imports: [AuthModule, AuthorizationModule, DatabaseModule],
  controllers: [RunnerReleaseController],
  providers: [
    RunnerReleaseService,
    {
      provide: RUNNER_RELEASE_TRUSTED_KEYS,
      useValue: TRUSTED_RUNNER_RELEASE_KEYS,
    },
  ],
})
export class RunnerReleaseModule {}
