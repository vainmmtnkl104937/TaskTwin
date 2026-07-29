'use server';

import { validateEditorWorkflow } from '@tasktwin/workflow-editor-core';
import { WorkflowDefinitionSchema } from '@tasktwin/workflow-schema';

import {
  WorkflowConflictResponseSchema,
  WorkflowDraftValidationErrorResponseSchema,
} from '@/lib/control-plane-contracts';
import { getAccessToken } from '@/lib/server/auth-session';
import {
  ControlPlaneError,
  patchWorkflowDraft,
} from '@/lib/server/control-plane';

export type SaveWorkflowDraftResult =
  | {
      status: 'success';
      revision: number;
      definition: unknown;
      updatedAt: string;
    }
  | {
      status: 'conflict';
      currentRevision?: number;
      message: string;
    }
  | {
      status: 'unauthorized' | 'error';
      message: string;
    };

export async function saveWorkflowDraftAction(
  workflowVersionId: string,
  expectedRevision: number,
  definitionInput: unknown,
): Promise<SaveWorkflowDraftResult> {
  const definition = WorkflowDefinitionSchema.safeParse(definitionInput);
  if (
    !definition.success ||
    validateEditorWorkflow(definitionInput).length > 0
  ) {
    return {
      status: 'error',
      message: 'Fix workflow validation errors before saving.',
    };
  }

  const accessToken = await getAccessToken();
  if (accessToken === null) {
    return {
      status: 'unauthorized',
      message: 'Your session has expired. Sign in again.',
    };
  }

  try {
    const response = await patchWorkflowDraft(
      accessToken,
      workflowVersionId,
      expectedRevision,
      definition.data,
    );
    return {
      status: 'success',
      revision: response.workflowVersion.revision,
      definition: response.workflowVersion.definition,
      updatedAt: response.workflowVersion.updatedAt,
    };
  } catch (error: unknown) {
    if (error instanceof ControlPlaneError && error.status === 401) {
      return {
        status: 'unauthorized',
        message: 'Your session has expired. Sign in again.',
      };
    }
    if (error instanceof ControlPlaneError && error.status === 409) {
      const conflict = WorkflowConflictResponseSchema.safeParse(error.body);
      if (conflict.success) {
        return {
          status: 'conflict',
          message:
            'This draft was saved elsewhere. Your local changes are still here.',
          ...(conflict.data.currentRevision === undefined
            ? {}
            : { currentRevision: conflict.data.currentRevision }),
        };
      }
    }
    if (error instanceof ControlPlaneError && error.status === 400) {
      const validation = WorkflowDraftValidationErrorResponseSchema.safeParse(
        error.body,
      );
      if (validation.success) {
        return {
          status: 'error',
          message: `${validation.data.issues.length} workflow input validation issue(s) must be fixed.`,
        };
      }
    }

    return {
      status: 'error',
      message: 'The draft could not be saved safely.',
    };
  }
}
