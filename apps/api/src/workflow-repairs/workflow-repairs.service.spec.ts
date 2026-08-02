import { ForbiddenException } from '@nestjs/common';
import {
  OrganizationRole,
  WorkflowRepairRepositoryError,
  type WorkflowRepairRecord,
  type WorkflowRepairRepository,
} from '@tasktwin/database';
import { describe, expect, it, vi } from 'vitest';

import { WorkflowRepairsService } from './workflow-repairs.service.js';

const record: WorkflowRepairRecord = {
  id: '00000000-0000-4000-8000-000000000031',
  workspaceId: '00000000-0000-4000-8000-000000000032',
  workflowRunId: '00000000-0000-4000-8000-000000000033',
  workflowId: 'repairWorkflow',
  workflowName: 'Repair workflow',
  workflowVersion: 1,
  runner: {
    id: '00000000-0000-4000-8000-000000000034',
    name: 'Attended Runner',
  },
  step: { id: 'fillEmail', index: 1, name: 'Fill email', type: 'fill' },
  attemptNumber: 1,
  safeErrorCode: 'LOCATOR_NOT_FOUND',
  effectCertainty: 'not_started',
  retryAllowed: true,
  status: 'PENDING',
  requestedAt: new Date('2026-08-02T00:00:00.000Z'),
  expiresAt: new Date('2026-08-02T00:02:00.000Z'),
  resolvedAt: null,
};

describe('WorkflowRepairsService', () => {
  it('returns only safe role-aware repair metadata', async () => {
    const repository = {
      listForWorkspace: vi.fn(async () => ({
        access: {
          userId: '00000000-0000-4000-8000-000000000035',
          organizationId: '00000000-0000-4000-8000-000000000036',
          workspaceId: record.workspaceId,
          role: OrganizationRole.MEMBER,
        },
        records: [record],
      })),
    } as unknown as WorkflowRepairRepository;
    const response = await new WorkflowRepairsService(repository).list(
      '00000000-0000-4000-8000-000000000035',
      record.workspaceId,
    );
    expect(response.access).toEqual({
      role: 'MEMBER',
      canRetry: false,
      canAbort: true,
    });
    expect(response.requests[0]?.safeErrorCode).toBe('LOCATOR_NOT_FOUND');
    expect(JSON.stringify(response)).not.toMatch(
      /selector|password|secretValue|rawError/i,
    );
  });

  it('maps unauthorized Retry decisions to Forbidden', async () => {
    const repository = {
      decide: vi.fn(async () => {
        throw new WorkflowRepairRepositoryError('REPAIR_FORBIDDEN');
      }),
    } as unknown as WorkflowRepairRepository;
    await expect(
      new WorkflowRepairsService(repository).decide(
        '00000000-0000-4000-8000-000000000035',
        record.id,
        'RETRY_APPROVED',
        { clientDecisionId: '00000000-0000-4000-8000-000000000037' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
