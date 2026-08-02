import { ForbiddenException } from '@nestjs/common';
import {
  OrganizationRole,
  WorkflowApprovalRepositoryError,
  type WorkflowApprovalRepository,
  type WorkflowApprovalRecord,
} from '@tasktwin/database';
import { describe, expect, it, vi } from 'vitest';

import { WorkflowApprovalsService } from './workflow-approvals.service.js';

const record: WorkflowApprovalRecord = {
  id: '00000000-0000-4000-8000-000000000021',
  workspaceId: '00000000-0000-4000-8000-000000000022',
  workflowRunId: '00000000-0000-4000-8000-000000000023',
  workflowId: 'approvalWorkflow',
  workflowName: 'Approval workflow',
  workflowVersion: 1,
  approvalStep: {
    id: 'approveSubmit',
    name: 'Approve submit',
    message: 'Review the submit action.',
  },
  gatedStep: { id: 'submit', name: 'Submit', type: 'click' },
  riskLevel: 'high',
  status: 'PENDING',
  requestedAt: new Date('2026-08-02T00:00:00.000Z'),
  expiresAt: new Date('2026-08-02T00:02:00.000Z'),
  resolvedAt: null,
};

describe('WorkflowApprovalsService', () => {
  it('returns safe role-aware approval metadata', async () => {
    const repository = {
      listForWorkspace: vi.fn(async () => ({
        access: {
          userId: '00000000-0000-4000-8000-000000000024',
          organizationId: '00000000-0000-4000-8000-000000000025',
          workspaceId: record.workspaceId,
          role: OrganizationRole.OWNER,
        },
        records: [record],
      })),
    } as unknown as WorkflowApprovalRepository;
    const response = await new WorkflowApprovalsService(repository).list(
      '00000000-0000-4000-8000-000000000024',
      record.workspaceId,
    );
    expect(response.access).toEqual({ role: 'OWNER', canDecide: true });
    expect(response.requests[0]?.approvalStep.message).toBe(
      'Review the submit action.',
    );
    expect(JSON.stringify(response)).not.toContain('locator');
  });

  it('maps unauthorized decisions to a generic forbidden response', async () => {
    const repository = {
      decide: vi.fn(async () => {
        throw new WorkflowApprovalRepositoryError('APPROVAL_FORBIDDEN');
      }),
    } as unknown as WorkflowApprovalRepository;
    await expect(
      new WorkflowApprovalsService(repository).decide(
        '00000000-0000-4000-8000-000000000024',
        record.id,
        'APPROVED',
        { clientDecisionId: '00000000-0000-4000-8000-000000000026' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
