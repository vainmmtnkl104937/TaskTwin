import type { ServiceHealthResponse } from '@tasktwin/shared-types';

export function getRunnerStatus(): ServiceHealthResponse {
  return {
    service: 'tasktwin-local-runner',
    status: 'healthy',
  };
}
