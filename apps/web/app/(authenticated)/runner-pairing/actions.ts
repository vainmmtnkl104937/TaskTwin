'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import type { PairingInspectionResponse } from '@/lib/control-plane-contracts';
import { getAccessToken } from '@/lib/server/auth-session';
import {
  approveRunnerPairing,
  ControlPlaneError,
  denyRunnerPairing,
  inspectRunnerPairing,
} from '@/lib/server/control-plane';

const InputSchema = z.strictObject({
  intent: z.enum(['inspect', 'approve', 'deny']),
  userCode: z.string().trim().min(1).max(32),
  workspaceId: z.string().uuid().optional(),
});

export interface RunnerPairingActionState {
  status: 'idle' | 'ready' | 'error';
  message?: string;
  userCode?: string;
  inspection?: PairingInspectionResponse;
}

export async function runnerPairingAction(
  previous: RunnerPairingActionState,
  formData: FormData,
): Promise<RunnerPairingActionState> {
  const input = InputSchema.safeParse({
    intent: formData.get('intent'),
    userCode: formData.get('userCode'),
    ...(formData.get('workspaceId') === null
      ? {}
      : { workspaceId: formData.get('workspaceId') }),
  });
  if (!input.success) {
    return {
      ...previous,
      status: 'error',
      message: 'Pairing input is invalid.',
    };
  }
  const accessToken = await getAccessToken();
  if (accessToken === null) {
    redirect('/login');
  }
  let approvedWorkspaceId: string | undefined;
  try {
    if (input.data.intent === 'inspect') {
      const inspection = await inspectRunnerPairing(
        accessToken,
        input.data.userCode,
      );
      return {
        status: 'ready',
        userCode: input.data.userCode,
        inspection,
      };
    }
    if (input.data.workspaceId === undefined) {
      return {
        ...previous,
        status: 'error',
        message: 'Select an authorized workspace.',
      };
    }
    if (input.data.intent === 'approve') {
      await approveRunnerPairing(
        accessToken,
        input.data.workspaceId,
        input.data.userCode,
      );
      approvedWorkspaceId = input.data.workspaceId;
    } else {
      await denyRunnerPairing(
        accessToken,
        input.data.workspaceId,
        input.data.userCode,
      );
      return {
        status: 'idle',
        message: 'Pairing request denied.',
      };
    }
  } catch (error: unknown) {
    if (error instanceof ControlPlaneError && error.status === 401) {
      redirect('/auth/expired');
    }
    return {
      ...previous,
      status: 'error',
      message:
        error instanceof ControlPlaneError &&
        (error.status === 403 || error.status === 404)
          ? 'Pairing session is unavailable for this workspace.'
          : 'Pairing action could not be completed.',
    };
  }
  if (approvedWorkspaceId === undefined) {
    return {
      ...previous,
      status: 'error',
      message: 'Pairing action could not be completed.',
    };
  }
  redirect(
    `/workspaces/${encodeURIComponent(approvedWorkspaceId)}/runner-devices`,
  );
}
