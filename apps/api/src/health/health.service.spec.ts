import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../database/prisma.service.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  const originalEnvironment = { ...process.env };
  let isHealthy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = 'a-secure-test-secret-with-32-characters';
    process.env.RUNNER_PAIRING_CODE_PEPPER = 'p'.repeat(32);
    process.env.RUNNER_CREDENTIAL_PEPPER = 'c'.repeat(32);
    process.env.RUNNER_JOB_LEASE_PEPPER = 'l'.repeat(32);
    process.env.TASKTWIN_WEB_BASE_URL = 'http://127.0.0.1:3000';
    isHealthy = vi.fn().mockResolvedValue(true);
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  const createService = () =>
    new HealthService({ isHealthy } as unknown as PrismaService);

  it('reports the API as healthy', () => {
    const service = createService();

    expect(service.getHealth()).toEqual({
      service: 'tasktwin-api',
      status: 'healthy',
    });
  });

  it('keeps liveness independent from the database', () => {
    const controller = new HealthController(createService());
    expect(controller.getLiveness()).toEqual({ status: 'alive' });
    expect(isHealthy).not.toHaveBeenCalled();
  });

  it('reports readiness with safe stable codes', async () => {
    await expect(createService().getReadiness()).resolves.toEqual({
      status: 'ready',
      checks: [
        { code: 'DATABASE_READY', status: 'pass' },
        { code: 'CONFIGURATION_READY', status: 'pass' },
      ],
    });
  });

  it('returns a safe 503 body when the database is unavailable', async () => {
    isHealthy.mockResolvedValue(false);
    await expect(createService().getReadiness()).rejects.toMatchObject({
      response: {
        status: 'not_ready',
        checks: expect.arrayContaining([
          { code: 'DATABASE_UNAVAILABLE', status: 'fail' },
        ]),
      },
      status: 503,
    });
  });

  it('does not expose invalid environment values', async () => {
    process.env.JWT_ACCESS_SECRET = 'TELEMETRY_SECRET_28';
    let body = '';
    try {
      await createService().getReadiness();
    } catch (error) {
      body = JSON.stringify(error);
    }
    expect(body).toContain('CONFIGURATION_INVALID');
    expect(body).not.toContain('TELEMETRY_SECRET_28');
  });
});
