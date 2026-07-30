import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  OrganizationRole,
  type WorkflowLifecycleRepository,
  WorkflowLifecycleRepositoryError,
  type WorkflowVersionDetailRecord,
} from '@tasktwin/database';
import { analyzePublishReadiness } from '@tasktwin/workflow-lifecycle';
import { describe, expect, it, vi } from 'vitest';

import { WorkflowLifecycleService } from './workflow-lifecycle.service.js';

const actorUserId = '7c50dc9a-0ec3-4115-86ca-ce2f85cac459';
const versionId = 'd7237734-c045-41ee-b07a-c184dd24a36e';

function detail(
  status: 'draft' | 'testing' | 'published' | 'archived' = 'testing',
): WorkflowVersionDetailRecord {
  return {
    id: versionId,
    workflowId: 'workflow-session-13',
    workspaceId: '4132fd4a-2f54-4da6-9400-df79d634c292',
    version: 1,
    revision: 3,
    status,
    schemaVersion: 1,
    definition: {
      schemaVersion: 1,
      workflowId: 'workflow-session-13',
      version: 1,
      name: 'Lifecycle workflow',
      status: 'draft',
      variables: [],
      steps: [
        {
          id: 'step-1',
          type: 'wait',
          name: 'Wait',
          durationMs: 100,
        },
      ],
    },
    createdFromVersionId: null,
    clientCreationId: null,
    publishedAt: null,
    publishedById: null,
    archivedAt: null,
    archivedById: null,
    createdAt: new Date('2026-07-30T10:00:00.000Z'),
    updatedAt: new Date('2026-07-30T10:00:00.000Z'),
    conversionReport: null,
    access: {
      userId: actorUserId,
      organizationId: '2958218d-e60f-4e34-b355-7e2cf5e807d7',
      role: OrganizationRole.MEMBER,
    },
  };
}

function createService(
  overrides: Partial<Record<keyof WorkflowLifecycleRepository, unknown>> = {},
) {
  const repository = {
    submitForTesting: vi.fn(),
    returnToDraft: vi.fn(),
    publish: vi.fn(),
    archive: vi.fn(),
    createDraftVersion: vi.fn(),
    listVersions: vi.fn(),
    ...overrides,
  };
  return {
    service: new WorkflowLifecycleService(
      repository as unknown as WorkflowLifecycleRepository,
    ),
    repository,
  };
}

describe('WorkflowLifecycleService', () => {
  it('validates and submits a Draft for Testing', async () => {
    const record = detail('testing');
    const submitForTesting = vi.fn().mockResolvedValue({
      workflowVersion: record,
      readiness: analyzePublishReadiness(record.definition),
      idempotent: false,
    });
    const { service } = createService({ submitForTesting });

    const response = await service.submitForTesting(actorUserId, versionId, {
      expectedRevision: 3,
    });

    expect(submitForTesting).toHaveBeenCalledWith(actorUserId, versionId, 3);
    expect(response.workflowVersion.status).toBe('testing');
    expect(response.publishReadiness.ready).toBe(true);
  });

  it('requires expectedRevision when returning to Draft', async () => {
    const { service } = createService();

    await expect(
      service.returnToDraft(actorUserId, versionId, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps repository role rejection without leaking details', async () => {
    const publish = vi
      .fn()
      .mockRejectedValue(
        new WorkflowLifecycleRepositoryError('WORKFLOW_LIFECYCLE_FORBIDDEN'),
      );
    const { service } = createService({ publish });

    await expect(
      service.publish(actorUserId, versionId, { expectedRevision: 3 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns safe readiness details for a blocked transition', async () => {
    const readiness = analyzePublishReadiness({
      schemaVersion: 1,
      workflowId: 'workflow-session-13',
      version: 1,
      name: 'Lifecycle workflow',
      status: 'draft',
      variables: [],
      steps: [],
    });
    const submitForTesting = vi
      .fn()
      .mockRejectedValue(
        new WorkflowLifecycleRepositoryError(
          'WORKFLOW_PUBLISH_READINESS_BLOCKED',
          { readiness },
        ),
      );
    const { service } = createService({ submitForTesting });

    await expect(
      service.submitForTesting(actorUserId, versionId, {
        expectedRevision: 3,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'WORKFLOW_PUBLISH_READINESS_BLOCKED',
        readiness: expect.objectContaining({ ready: false }),
      }),
    });
  });
});
