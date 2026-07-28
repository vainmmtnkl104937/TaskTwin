import { Controller, Get } from '@nestjs/common';
import type { ServiceHealthResponse } from '@tasktwin/shared-types';

import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getHealth(): ServiceHealthResponse {
    return this.healthService.getHealth();
  }
}
