import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { DatabaseHealthService } from './database-health.service.js';
import type { PrismaService } from './prisma.service.js';

describe('DatabaseHealthService', () => {
  it('reports the database as healthy when the probe succeeds', async () => {
    const prisma = {
      isHealthy: vi.fn().mockResolvedValue(true),
    } as unknown as PrismaService;
    const service = new DatabaseHealthService(prisma);

    await expect(service.getHealth()).resolves.toEqual({
      service: 'tasktwin-database',
      status: 'healthy',
    });
  });

  it('returns a safe unavailable response when the probe fails', async () => {
    const prisma = {
      isHealthy: vi.fn().mockResolvedValue(false),
    } as unknown as PrismaService;
    const service = new DatabaseHealthService(prisma);

    try {
      await service.getHealth();
      throw new Error('Expected the database health check to fail');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getResponse()).toEqual({
        service: 'tasktwin-database',
        status: 'unhealthy',
      });
    }
  });
});
