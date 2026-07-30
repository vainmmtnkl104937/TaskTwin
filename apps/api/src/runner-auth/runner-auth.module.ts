import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { RunnerPairingModule } from '../runner-pairing/runner-pairing.module.js';
import { RunnerCredentialGuard } from './runner-credential.guard.js';

@Module({
  imports: [DatabaseModule, RunnerPairingModule],
  providers: [RunnerCredentialGuard],
  exports: [RunnerCredentialGuard],
})
export class RunnerAuthModule {}
