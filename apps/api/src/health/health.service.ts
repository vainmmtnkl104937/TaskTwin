import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { ServiceHealthResponse } from '@tasktwin/shared-types';

import { PrismaService } from '../database/prisma.service.js';
import {
  getApiPort,
  getJwtAccessConfiguration,
  getRunnerJobSecurityConfiguration,
  getRunnerSecurityConfiguration,
} from '../config/environment.js';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  getHealth(): ServiceHealthResponse {
    return {
      service: 'tasktwin-api',
      status: 'healthy',
    };
  }

  async getReadiness(): Promise<{
    status: 'ready';
    checks: readonly { code: string; status: 'pass' }[];
  }> {
    const databaseReady = await this.prisma.isHealthy();
    let configurationReady = true;
    try {
      getApiPort();
      getJwtAccessConfiguration();
      getRunnerSecurityConfiguration();
      getRunnerJobSecurityConfiguration();
    } catch {
      configurationReady = false;
    }
    const checks = [
      {
        code: databaseReady ? 'DATABASE_READY' : 'DATABASE_UNAVAILABLE',
        status: databaseReady ? 'pass' : 'fail',
      },
      {
        code: configurationReady
          ? 'CONFIGURATION_READY'
          : 'CONFIGURATION_INVALID',
        status: configurationReady ? 'pass' : 'fail',
      },
    ] as const;
    if (!databaseReady || !configurationReady) {
      throw new ServiceUnavailableException({ status: 'not_ready', checks });
    }
    return {
      status: 'ready',
      checks: checks.map(({ code }) => ({ code, status: 'pass' as const })),
    };
  }
}
