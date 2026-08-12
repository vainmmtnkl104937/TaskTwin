import { ConflictException } from '@nestjs/common';
import {
  SecureRunInputRepositoryError,
  type SecureRunInputRepository,
  type WorkflowRunRepository,
} from '@tasktwin/database';
import { describe, expect, it, vi } from 'vitest';

import { WorkflowRunsService } from './workflow-runs.service.js';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const WORKFLOW_VERSION_ID = '00000000-0000-4000-8000-000000000002';
const RUNNER_DEVICE_ID = '00000000-0000-4000-8000-000000000003';

describe('WorkflowRunsService secure input readiness', () => {
  it('returns safe readiness detail when preparation is not ready', async () => {
    const readiness = {
      schemaVersion: 1,
      ready: false,
      issues: [{ code: 'POLICY_DENIED', severity: 'blocking' }],
    };
    const prepare = vi.fn(async () => {
      throw new SecureRunInputRepositoryError('RUN_NOT_READY', readiness);
    });
    const service = new WorkflowRunsService(
      {} as WorkflowRunRepository,
      { prepare } as unknown as SecureRunInputRepository,
    );

    let thrown: unknown;
    try {
      await service.prepareInputs(USER_ID, WORKFLOW_VERSION_ID, {
        schemaVersion: 1,
        clientPreparationId: '00000000-0000-4000-8000-000000000004',
        clientRunId: '00000000-0000-4000-8000-000000000005',
        runnerDeviceId: RUNNER_DEVICE_ID,
        options: {
          totalTimeoutMs: 120_000,
          stepTimeoutMs: 30_000,
        },
      });
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConflictException);
    expect((thrown as ConflictException).getResponse()).toEqual({
      code: 'RUN_NOT_READY',
      message: 'The secure run input operation conflicts with current state.',
      readiness,
    });
  });
});
