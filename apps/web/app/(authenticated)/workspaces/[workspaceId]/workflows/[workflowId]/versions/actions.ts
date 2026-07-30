'use server';

import type { PublishReadinessReport } from '@tasktwin/workflow-lifecycle';

import { WorkflowLifecycleErrorResponseSchema } from '@/lib/control-plane-contracts';
import { getAccessToken } from '@/lib/server/auth-session';
import {
  archiveWorkflowVersion,
  ControlPlaneError,
  createWorkflowDraftVersion,
  publishWorkflowVersion,
  returnWorkflowVersionToDraft,
  submitWorkflowVersionForTesting,
} from '@/lib/server/control-plane';

export type WorkflowLifecycleActionResult =
  | {
      status: 'success';
      versionId: string;
      workflowStatus: 'draft' | 'testing' | 'published' | 'archived';
      idempotent: boolean;
    }
  | {
      status: 'conflict' | 'forbidden' | 'invalid' | 'unauthorized' | 'error';
      message: string;
      currentRevision?: number;
      readiness?: PublishReadinessReport;
    };

type LifecycleOperation = (
  accessToken: string,
) => ReturnType<typeof submitWorkflowVersionForTesting>;

async function runLifecycleOperation(
  operation: LifecycleOperation,
): Promise<WorkflowLifecycleActionResult> {
  const accessToken = await getAccessToken();
  if (accessToken === null) {
    return {
      status: 'unauthorized',
      message: 'Your session has expired. Sign in again.',
    };
  }

  try {
    const response = await operation(accessToken);
    return {
      status: 'success',
      versionId: response.workflowVersion.id,
      workflowStatus: response.workflowVersion.status,
      idempotent: response.idempotent,
    };
  } catch (error: unknown) {
    if (!(error instanceof ControlPlaneError)) {
      return {
        status: 'error',
        message: 'The lifecycle action could not be completed safely.',
      };
    }

    const parsed = WorkflowLifecycleErrorResponseSchema.safeParse(error.body);
    const safeError = parsed.success ? parsed.data : undefined;
    if (error.status === 401) {
      return {
        status: 'unauthorized',
        message: 'Your session has expired. Sign in again.',
      };
    }
    if (error.status === 403) {
      return {
        status: 'forbidden',
        message: safeError?.message ?? 'This action is not allowed.',
      };
    }
    if (error.status === 409) {
      return {
        status: 'conflict',
        message:
          safeError?.message ??
          'The workflow version changed. Refresh before retrying.',
        ...(safeError?.currentRevision === undefined
          ? {}
          : { currentRevision: safeError.currentRevision }),
        ...(safeError?.readiness === undefined
          ? {}
          : { readiness: safeError.readiness }),
      };
    }
    if (error.status === 400) {
      return {
        status: 'invalid',
        message:
          safeError?.message ??
          'The workflow version is not ready for this action.',
        ...(safeError?.readiness === undefined
          ? {}
          : { readiness: safeError.readiness }),
      };
    }

    return {
      status: 'error',
      message: 'The lifecycle action could not be completed safely.',
    };
  }
}

export async function submitForTestingAction(
  workflowVersionId: string,
  expectedRevision: number,
): Promise<WorkflowLifecycleActionResult> {
  return await runLifecycleOperation((accessToken) =>
    submitWorkflowVersionForTesting(
      accessToken,
      workflowVersionId,
      expectedRevision,
    ),
  );
}

export async function returnToDraftAction(
  workflowVersionId: string,
  expectedRevision: number,
): Promise<WorkflowLifecycleActionResult> {
  return await runLifecycleOperation((accessToken) =>
    returnWorkflowVersionToDraft(
      accessToken,
      workflowVersionId,
      expectedRevision,
    ),
  );
}

export async function publishVersionAction(
  workflowVersionId: string,
  expectedRevision: number,
): Promise<WorkflowLifecycleActionResult> {
  return await runLifecycleOperation((accessToken) =>
    publishWorkflowVersion(accessToken, workflowVersionId, expectedRevision),
  );
}

export async function archiveVersionAction(
  workflowVersionId: string,
): Promise<WorkflowLifecycleActionResult> {
  return await runLifecycleOperation((accessToken) =>
    archiveWorkflowVersion(accessToken, workflowVersionId),
  );
}

export async function createDraftVersionAction(
  workflowId: string,
  sourceVersionId: string,
  clientCreationId: string,
): Promise<WorkflowLifecycleActionResult> {
  return await runLifecycleOperation((accessToken) =>
    createWorkflowDraftVersion(
      accessToken,
      workflowId,
      sourceVersionId,
      clientCreationId,
    ),
  );
}
