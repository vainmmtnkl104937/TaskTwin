import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { OperationsController } from './operations.controller.js';
import { OperationsQueryService } from './operations-query.service.js';

@Module({
  imports: [AuthModule, AuthorizationModule, DatabaseModule],
  controllers: [OperationsController],
  providers: [OperationsQueryService],
})
export class OperationsModule {}
