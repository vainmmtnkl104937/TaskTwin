import {
  BadRequestException,
  type ExecutionContext,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  OrganizationRole,
  type RecordingRepository,
  type RunnerRepository,
  type WorkflowDraftRepository,
  type WorkflowLifecycleRepository,
} from '@tasktwin/database';
import { describe, expect, it, vi } from 'vitest';

import { AUTHENTICATED_USER } from '../auth/authenticated-request.js';
import {
  VERIFIED_ORGANIZATION_CONTEXT,
  type VerifiedOrganizationContext,
} from './organization-context.js';
import { OrganizationResourceContextGuard } from './organization-resource-context.guard.js';

const userId = '74c2fef6-54cb-438d-b343-77e4cfd19806';
const workspaceId = '74ef5779-b652-4dd2-88f8-2f88e1bbac71';

interface TestRequest {
  headers: Record<string, string>;
  params: Record<string, unknown>;
  [AUTHENTICATED_USER]: {
    id: string;
    email: string;
    displayName: string;
  };
  [VERIFIED_ORGANIZATION_CONTEXT]?: VerifiedOrganizationContext;
}

function createRequest(
  resourceId: unknown = workspaceId,
  parameterName = 'workspaceId',
): TestRequest {
  return {
    headers: {},
    params: { [parameterName]: resourceId },
    [AUTHENTICATED_USER]: {
      id: userId,
      email: 'owner@example.test',
      displayName: 'Owner',
    },
  };
}

function createExecutionContext(request: TestRequest): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function createReflector(
  kind:
    | 'workspace'
    | 'recordingSession'
    | 'workflow'
    | 'workflowVersion'
    | 'runnerDevice' = 'workspace',
  parameterName = 'workspaceId',
): Reflector {
  return {
    getAllAndOverride: vi.fn().mockReturnValue({
      kind,
      parameterName,
    }),
  } as unknown as Reflector;
}

describe('OrganizationResourceContextGuard', () => {
  const workflowDraftRepository = {
    resolveWorkflowVersionAccess: vi.fn(),
  } as unknown as WorkflowDraftRepository;
  const workflowLifecycleRepository = {
    resolveWorkflowAccess: vi.fn(),
  } as unknown as WorkflowLifecycleRepository;
  const runnerRepository = {
    resolveRunnerDeviceAccess: vi.fn(),
  } as unknown as RunnerRepository;

  it('resolves membership and attaches trusted organization context', async () => {
    const request = createRequest();
    const resolveWorkspaceAccess = vi.fn().mockResolvedValue({
      organizationId: '13375635-b896-4446-81ed-2de3fa201dac',
      userId,
      role: OrganizationRole.MEMBER,
    });
    const guard = new OrganizationResourceContextGuard(
      createReflector(),
      {
        resolveWorkspaceAccess,
      } as unknown as RecordingRepository,
      workflowDraftRepository,
      workflowLifecycleRepository,
      runnerRepository,
    );

    await expect(
      guard.canActivate(createExecutionContext(request)),
    ).resolves.toBe(true);
    expect(resolveWorkspaceAccess).toHaveBeenCalledWith(userId, workspaceId);
    expect(request[VERIFIED_ORGANIZATION_CONTEXT]).toMatchObject({
      userId,
      role: OrganizationRole.MEMBER,
    });
  });

  it('returns not found for an inaccessible cross-organization resource', async () => {
    const guard = new OrganizationResourceContextGuard(
      createReflector(),
      {
        resolveWorkspaceAccess: vi.fn().mockResolvedValue(null),
      } as unknown as RecordingRepository,
      workflowDraftRepository,
      workflowLifecycleRepository,
      runnerRepository,
    );

    await expect(
      guard.canActivate(createExecutionContext(createRequest())),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects an invalid route identifier before repository access', async () => {
    const resolveWorkspaceAccess = vi.fn();
    const guard = new OrganizationResourceContextGuard(
      createReflector(),
      {
        resolveWorkspaceAccess,
      } as unknown as RecordingRepository,
      workflowDraftRepository,
      workflowLifecycleRepository,
      runnerRepository,
    );

    await expect(
      guard.canActivate(createExecutionContext(createRequest('not-a-uuid'))),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(resolveWorkspaceAccess).not.toHaveBeenCalled();
  });

  it('resolves workflow-version membership through the workflow repository', async () => {
    const workflowVersionId = 'b39dfd6a-febf-42f6-b6c0-85c662509ad8';
    const resolveWorkflowVersionAccess = vi.fn().mockResolvedValue({
      organizationId: '13375635-b896-4446-81ed-2de3fa201dac',
      userId,
      role: OrganizationRole.VIEWER,
    });
    const guard = new OrganizationResourceContextGuard(
      createReflector('workflowVersion', 'workflowVersionId'),
      {} as RecordingRepository,
      {
        resolveWorkflowVersionAccess,
      } as unknown as WorkflowDraftRepository,
      workflowLifecycleRepository,
      runnerRepository,
    );

    await expect(
      guard.canActivate(
        createExecutionContext(
          createRequest(workflowVersionId, 'workflowVersionId'),
        ),
      ),
    ).resolves.toBe(true);
    expect(resolveWorkflowVersionAccess).toHaveBeenCalledWith(
      userId,
      workflowVersionId,
    );
  });

  it('resolves workflow membership through the lifecycle repository', async () => {
    const workflowId = 'workflow-session-13';
    const resolveWorkflowAccess = vi.fn().mockResolvedValue({
      organizationId: '13375635-b896-4446-81ed-2de3fa201dac',
      userId,
      role: OrganizationRole.ADMIN,
    });
    const guard = new OrganizationResourceContextGuard(
      createReflector('workflow', 'workflowId'),
      {} as RecordingRepository,
      workflowDraftRepository,
      {
        resolveWorkflowAccess,
      } as unknown as WorkflowLifecycleRepository,
      runnerRepository,
    );

    await expect(
      guard.canActivate(
        createExecutionContext(createRequest(workflowId, 'workflowId')),
      ),
    ).resolves.toBe(true);
    expect(resolveWorkflowAccess).toHaveBeenCalledWith(userId, workflowId);
  });
});
