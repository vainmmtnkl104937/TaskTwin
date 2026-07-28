import { Injectable } from '@nestjs/common';
import type { ServiceHealthResponse } from '@tasktwin/shared-types';

@Injectable()
export class HealthService {
  getHealth(): ServiceHealthResponse {
    return {
      service: 'tasktwin-api',
      status: 'healthy',
    };
  }
}
