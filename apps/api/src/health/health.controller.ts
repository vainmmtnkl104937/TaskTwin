import { Controller, Get } from '@nestjs/common';
import type { ServiceHealthResponse } from '@tasktwin/shared-types';

import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getHealth(): ServiceHealthResponse {
    return this.healthService.getHealth();
  }

  @Get('live')
  getLiveness(): { status: 'alive' } {
    return { status: 'alive' };
  }

  @Get('ready')
  getReadiness(): Promise<{
    status: 'ready';
    checks: readonly { code: string; status: 'pass' }[];
  }> {
    return this.healthService.getReadiness();
  }
}
