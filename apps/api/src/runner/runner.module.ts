import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { RunnerAuthModule } from '../runner-auth/runner-auth.module.js';
import { RunnerPairingModule } from '../runner-pairing/runner-pairing.module.js';
import { RunnerController } from './runner.controller.js';
import { RunnerService } from './runner.service.js';

@Module({
  imports: [
    AuthModule,
    AuthorizationModule,
    DatabaseModule,
    RunnerAuthModule,
    RunnerPairingModule,
  ],
  controllers: [RunnerController],
  providers: [RunnerService],
})
export class RunnerModule {}
