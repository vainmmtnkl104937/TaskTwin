import { describe, expect, it } from 'vitest';

import { getRunnerStatus } from './status.js';

describe('getRunnerStatus', () => {
  it('reports the local runner as healthy', () => {
    expect(getRunnerStatus()).toEqual({
      service: 'tasktwin-local-runner',
      status: 'healthy',
    });
  });
});
