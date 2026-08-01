'use server';

import { z } from 'zod';
import { SecureRunInputEnvelopeSchema } from '@tasktwin/secure-run-inputs';

import { getAccessToken } from '@/lib/server/auth-session';
import {
  ControlPlaneError,
  cancelWorkflowRun,
  createWorkflowRun,
  prepareWorkflowRunInputs,
  commitWorkflowRunInputs,
} from '@/lib/server/control-plane';

const CreateInputSchema = z.strictObject({
  workspaceId: z.string().uuid(),
  workflowVersionId: z.string().uuid(),
  runnerDeviceId: z.string().uuid(),
  clientRunId: z.string().uuid(),
});

const PrepareInputSchema = CreateInputSchema.extend({
  clientPreparationId: z.string().uuid(),
});

const CommitInputSchema = z.strictObject({
  workspaceId: z.string().uuid(),
  preparationId: z.string().uuid(),
  envelope: SecureRunInputEnvelopeSchema,
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

export async function prepareWorkflowRunInputsAction(input: unknown) {
  const parsed = PrepareInputSchema.safeParse(input);
  const token = await getAccessToken();
  if (!parsed.success || token === null) {
    return { ok: false as const, message: 'Invalid secure input request.' };
  }
  try {
    const response = await prepareWorkflowRunInputs(
      token,
      parsed.data.workflowVersionId,
      {
        clientPreparationId: parsed.data.clientPreparationId,
        clientRunId: parsed.data.clientRunId,
        runnerDeviceId: parsed.data.runnerDeviceId,
        options: { totalTimeoutMs: 120_000, stepTimeoutMs: 30_000 },
      },
    );
    return { ok: true as const, preparation: response.preparation };
  } catch (error: unknown) {
    return {
      ok: false as const,
      message:
        error instanceof ControlPlaneError && error.status === 409
          ? 'The selected Runner cannot receive these inputs safely.'
          : 'Secure input preparation failed.',
    };
  }
}

export async function commitWorkflowRunInputsAction(input: unknown) {
  const parsed = CommitInputSchema.safeParse(input);
  const token = await getAccessToken();
  if (!parsed.success || token === null) {
    return { ok: false as const, message: 'Invalid encrypted input envelope.' };
  }
  try {
    const response = await commitWorkflowRunInputs(
      token,
      parsed.data.preparationId,
      parsed.data.envelope,
    );
    return { ok: true as const, runId: response.run.id };
  } catch (error: unknown) {
    return {
      ok: false as const,
      message:
        error instanceof ControlPlaneError && error.status === 409
          ? 'The secure input preparation expired or conflicts.'
          : 'The encrypted run could not be created.',
    };
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
