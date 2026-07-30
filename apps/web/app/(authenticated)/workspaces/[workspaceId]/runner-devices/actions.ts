'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { getAccessToken } from '@/lib/server/auth-session';
import {
  ControlPlaneError,
  revokeRunnerDevice,
} from '@/lib/server/control-plane';

const RevokeInputSchema = z.strictObject({
  runnerDeviceId: z.string().uuid(),
  workspaceId: z.string().uuid(),
});

export async function revokeRunnerDeviceAction(input: {
  runnerDeviceId: string;
  workspaceId: string;
}): Promise<{ ok: boolean; message?: string }> {
  const parsed = RevokeInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: 'Runner device is invalid.' };
  }
  const token = await getAccessToken();
  if (token === null) {
    redirect('/login');
  }
  try {
    await revokeRunnerDevice(token, parsed.data.runnerDeviceId);
    return { ok: true };
  } catch (error: unknown) {
    if (error instanceof ControlPlaneError && error.status === 401) {
      redirect('/auth/expired');
    }
    return { ok: false, message: 'Runner could not be revoked.' };
  }
}
