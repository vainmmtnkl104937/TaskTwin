'use server';

import { z } from 'zod';

import { getAccessToken } from '@/lib/server/auth-session';
import {
  ControlPlaneError,
  cancelWorkflowRun,
  createWorkflowRun,
} from '@/lib/server/control-plane';

const CreateInputSchema = z.strictObject({
  workspaceId: z.string().uuid(),
  workflowVersionId: z.string().uuid(),
  runnerDeviceId: z.string().uuid(),
  clientRunId: z.string().uuid(),
});

export async function createWorkflowRunAction(input: unknown) {
  const parsed = CreateInputSchema.safeParse(input);
  const token = await getAccessToken();
  if (!parsed.success || token === null) {
    return { ok: false as const, message: 'Invalid run request.' };
  }
  try {
    const response = await createWorkflowRun(
      token,
      parsed.data.workflowVersionId,
      parsed.data.runnerDeviceId,
      parsed.data.clientRunId,
    );
    return { ok: true as const, runId: response.run.id };
  } catch (error: unknown) {
    if (error instanceof ControlPlaneError && error.status === 409) {
      return {
        ok: false as const,
        message: 'This workflow is not ready for local execution.',
      };
    }
    return { ok: false as const, message: 'The run could not be created.' };
  }
}

export async function cancelWorkflowRunAction(
  workspaceId: string,
  workflowRunId: string,
) {
  if (
    !z.string().uuid().safeParse(workspaceId).success ||
    !z.string().uuid().safeParse(workflowRunId).success
  ) {
    return { ok: false as const, message: 'Invalid cancellation request.' };
  }
  const token = await getAccessToken();
  if (token === null) {
    return { ok: false as const, message: 'Authentication expired.' };
  }
  try {
    await cancelWorkflowRun(token, workflowRunId);
    return { ok: true as const };
  } catch {
    return {
      ok: false as const,
      message: 'Cancellation could not be requested.',
    };
  }
}
