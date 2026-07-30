import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PairingCryptoService } from './pairing-crypto.service.js';
import { RunnerPairingController } from './runner-pairing.controller.js';
import { RunnerPairingService } from './runner-pairing.service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [RunnerPairingController],
  providers: [PairingCryptoService, RunnerPairingService],
  exports: [PairingCryptoService],
})
export class RunnerPairingModule {}
