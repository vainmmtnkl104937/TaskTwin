import { describe, expect, it } from 'vitest';

import { HealthService } from './health.service';

describe('HealthService', () => {
  it('reports the API as healthy', () => {
    const service = new HealthService();

    expect(service.getHealth()).toEqual({
      service: 'tasktwin-api',
      status: 'healthy',
    });
  });
});
