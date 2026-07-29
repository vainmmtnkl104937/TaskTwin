import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { ServiceHealthResponse } from '@tasktwin/shared-types';

import { PrismaService } from './prisma.service.js';

@Injectable()
export class DatabaseHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async getHealth(): Promise<ServiceHealthResponse> {
    const isHealthy = await this.prisma.isHealthy();

    if (!isHealthy) {
      throw new ServiceUnavailableException({
        service: 'tasktwin-database',
        status: 'unhealthy',
      } satisfies ServiceHealthResponse);
    }

    return {
      service: 'tasktwin-database',
      status: 'healthy',
    };
  }
}
