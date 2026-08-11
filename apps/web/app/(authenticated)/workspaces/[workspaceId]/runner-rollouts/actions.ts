'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { getAccessToken } from '@/lib/server/auth-session';
import {
  activateRunnerRolloutStage,
  createRunnerRollout,
  mutateRunnerRollout,
} from '@/lib/server/control-plane';

function required(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing ${name}.`);
  }
  return value.trim();
}

function ids(value: FormDataEntryValue | null): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function createRolloutAction(formData: FormData): Promise<void> {
  const token = await getAccessToken();
  if (token === null) redirect('/login');
  const workspaceId = required(formData, 'workspaceId');
  const stages = [1, 2, 3]
    .map((stageNumber) => ({
      stageNumber,
      runnerDeviceIds: ids(formData.get(`stage${stageNumber}`)),
    }))
    .filter((stage) => stage.runnerDeviceIds.length > 0)
    .map((stage, index) => ({ ...stage, stageNumber: index + 1 }));
  const result = await createRunnerRollout(token, workspaceId, {
    clientRolloutId: randomUUID(),
    targetReleaseId: required(formData, 'targetReleaseId'),
    stages,
  });
  redirect(`/workspaces/${workspaceId}/runner-rollouts/${result.rollout.id}`);
}

export async function rolloutAction(formData: FormData): Promise<void> {
  const token = await getAccessToken();
  if (token === null) redirect('/login');
  const workspaceId = required(formData, 'workspaceId');
  const rolloutId = required(formData, 'rolloutId');
  const action = required(formData, 'action');
  if (action !== 'activate' && action !== 'pause' && action !== 'cancel') {
    throw new Error('Invalid rollout action.');
  }
  await mutateRunnerRollout(token, rolloutId, action);
  revalidatePath(`/workspaces/${workspaceId}/runner-rollouts/${rolloutId}`);
}

export async function activateStageAction(formData: FormData): Promise<void> {
  const token = await getAccessToken();
  if (token === null) redirect('/login');
  const workspaceId = required(formData, 'workspaceId');
  const rolloutId = required(formData, 'rolloutId');
  const stageNumber = Number(required(formData, 'stageNumber'));
  await activateRunnerRolloutStage(token, rolloutId, stageNumber);
  revalidatePath(`/workspaces/${workspaceId}/runner-rollouts/${rolloutId}`);
}
