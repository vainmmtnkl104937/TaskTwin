import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  OrganizationRole,
  type WorkflowDraftRepository,
  WorkflowDraftRepositoryError,
} from '@tasktwin/database';
import type { WorkflowDefinition } from '@tasktwin/workflow-schema';
import { describe, expect, it, vi } from 'vitest';

import { WorkflowsService } from './workflows.service.js';

const userId = '491b17ed-d650-485a-9f28-77cfcc58a83c';
const workspaceId = '40198cd7-489f-42d9-a6e0-04e26a73527f';
const versionId = 'a454416f-8a75-4b1e-839b-ea19393da6b5';

function definition(name = 'Workflow'): WorkflowDefinition {
  return {
    schemaVersion: 1,
    workflowId: 'workflow-session-11',
    version: 1,
    name,
    status: 'draft',
    variables: [],
    steps: [
      {
        id: 'step-1',
        type: 'wait',
        name: 'Wait',
        durationMs: 500,
      },
    ],
  };
}

function detail(role: OrganizationRole = OrganizationRole.MEMBER) {
  return {
    id: versionId,
    workflowId: 'workflow-session-11',
    workspaceId,
    version: 1,
    revision: 2,
    status: 'draft' as const,
    schemaVersion: 1,
    definition: definition(),
    updatedAt: new Date('2026-07-29T20:00:00.000Z'),
    conversionReport: null,
    access: {
      organizationId: '31cc18a2-068e-4daf-95ce-47bfb69457c5',
      userId,
      role,
    },
  };
}

describe('WorkflowsService', () => {
  it('returns a membership-scoped workflow list with safe metadata only', async () => {
    const listForWorkspace = vi.fn().mockResolvedValue({
      workspaceId,
      access: detail().access,
      workflows: [
        {
          id: 'workflow-session-11',
          name: 'Workflow',
          description: null,
          latestVersionId: versionId,
          version: 1,
          revision: 2,
          status: 'draft',
          updatedAt: new Date('2026-07-29T20:00:00.000Z'),
        },
      ],
    });
    const service = new WorkflowsService({
      listForWorkspace,
    } as unknown as WorkflowDraftRepository);

    const result = await service.list(userId, workspaceId);

    expect(result.workflows[0]).not.toHaveProperty('definition');
    expect(result.access).toEqual({ role: 'MEMBER', canEdit: true });
  });

  it('allows VIEWER detail reads but reports the editor as read-only', async () => {
    const service = new WorkflowsService({
      getVersion: vi.fn().mockResolvedValue(detail(OrganizationRole.VIEWER)),
    } as unknown as WorkflowDraftRepository);

    await expect(service.getVersion(userId, versionId)).resolves.toMatchObject({
      access: { role: 'VIEWER', canEdit: false },
    });
  });

  it('rejects invalid complete definitions before repository access', async () => {
    const updateDraft = vi.fn();
    const service = new WorkflowsService({
      updateDraft,
    } as unknown as WorkflowDraftRepository);

    await expect(
      service.updateDraft(userId, versionId, {
        expectedRevision: 1,
        definition: { ...definition(), unexpected: true },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it('saves valid variables and rejects unknown references safely', async () => {
    const validDefinition = definition();
    validDefinition.variables = [
      {
        name: 'customerEmail',
        valueType: 'string',
        required: true,
      },
    ];
    validDefinition.steps = [
      {
        id: 'step-1',
        type: 'fill',
        name: 'Fill customer email',
        locator: { kind: 'label', value: 'Email' },
        value: { kind: 'variable', variableName: 'customerEmail' },
      },
    ];
    const updateDraft = vi.fn().mockResolvedValue({
      workflowVersion: {
        ...detail(),
        definition: validDefinition,
      },
    });
    const service = new WorkflowsService({
      updateDraft,
    } as unknown as WorkflowDraftRepository);

    await expect(
      service.updateDraft(userId, versionId, {
        expectedRevision: 1,
        definition: validDefinition,
      }),
    ).resolves.toMatchObject({
      workflowVersion: { definition: validDefinition },
    });

    const invalidDefinition = structuredClone(validDefinition);
    const fill = invalidDefinition.steps[0]!;
    if (fill.type !== 'fill') {
      throw new Error('Expected Fill step');
    }
    fill.value = {
      kind: 'variable',
      variableName: 'missingVariable',
    };

    await expect(
      service.updateDraft(userId, versionId, {
        expectedRevision: 1,
        definition: invalidDefinition,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'WORKFLOW_INPUT_VALIDATION_FAILED',
        issues: [
          expect.objectContaining({
            code: 'UNKNOWN_VARIABLE_REFERENCE',
            variableName: 'missingVariable',
          }),
        ],
      },
    });
    expect(updateDraft).toHaveBeenCalledTimes(1);
  });

  it('rejects duplicate variables and unsafe secret aliases without echoing raw data', async () => {
    const updateDraft = vi.fn();
    const service = new WorkflowsService({
      updateDraft,
    } as unknown as WorkflowDraftRepository);
    const duplicate = definition();
    duplicate.variables = [
      { name: 'customerEmail', valueType: 'string', required: true },
      { name: 'customerEmail', valueType: 'string', required: false },
    ];

    await expect(
      service.updateDraft(userId, versionId, {
        expectedRevision: 1,
        definition: duplicate,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'WORKFLOW_INPUT_VALIDATION_FAILED',
        issues: [expect.objectContaining({ code: 'DUPLICATE_VARIABLE_NAME' })],
      },
    });

    const unsafe = definition();
    unsafe.steps = [
      {
        id: 'step-1',
        type: 'fill',
        name: 'Fill secret',
        locator: { kind: 'label', value: 'Secret' },
        value: {
          kind: 'secret',
          secretName: 'person@example.com',
        },
      },
    ];
    let caught: unknown;
    try {
      await service.updateDraft(userId, versionId, {
        expectedRevision: 1,
        definition: unsafe,
      });
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toMatchObject({
      response: {
        code: 'WORKFLOW_INPUT_VALIDATION_FAILED',
        issues: [expect.objectContaining({ code: 'UNSAFE_SECRET_REFERENCE' })],
      },
    });
    expect(JSON.stringify(caught)).not.toContain('person@example.com');
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it('maps stale, non-draft and forbidden writes to safe HTTP errors', async () => {
    const updateDraft = vi
      .fn()
      .mockRejectedValueOnce(
        new WorkflowDraftRepositoryError('WORKFLOW_DRAFT_REVISION_CONFLICT', 4),
      )
      .mockRejectedValueOnce(
        new WorkflowDraftRepositoryError('WORKFLOW_VERSION_NOT_DRAFT'),
      )
      .mockRejectedValueOnce(
        new WorkflowDraftRepositoryError('WORKFLOW_DRAFT_FORBIDDEN'),
      );
    const service = new WorkflowsService({
      updateDraft,
    } as unknown as WorkflowDraftRepository);
    const request = { expectedRevision: 1, definition: definition() };

    await expect(
      service.updateDraft(userId, versionId, request),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'WORKFLOW_DRAFT_REVISION_CONFLICT',
        currentRevision: 4,
      }),
    });
    await expect(
      service.updateDraft(userId, versionId, request),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.updateDraft(userId, versionId, request),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns the atomically incremented revision after save', async () => {
    const record = detail();
    const service = new WorkflowsService({
      updateDraft: vi.fn().mockResolvedValue({ workflowVersion: record }),
    } as unknown as WorkflowDraftRepository);

    await expect(
      service.updateDraft(userId, versionId, {
        expectedRevision: 1,
        definition: definition(),
      }),
    ).resolves.toMatchObject({
      workflowVersion: { revision: 2 },
    });
  });
});
