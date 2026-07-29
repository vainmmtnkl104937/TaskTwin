import { Controller, Get } from '@nestjs/common';
import type { ServiceHealthResponse } from '@tasktwin/shared-types';

import { DatabaseHealthService } from './database-health.service.js';

@Controller('health/database')
export class DatabaseHealthController {
  constructor(private readonly databaseHealthService: DatabaseHealthService) {}

  @Get()
  getHealth(): Promise<ServiceHealthResponse> {
    return this.databaseHealthService.getHealth();
  }
}
