'use server';

import { z } from 'zod';

import { getAccessToken } from '@/lib/server/auth-session';
import {
  ControlPlaneError,
  createWorkflowSchedule,
  pauseWorkflowSchedule,
  resumeWorkflowSchedule,
  archiveWorkflowSchedule,
} from '@/lib/server/control-plane';
import { ScheduleDefinitionSchema } from '@/lib/schedule-contracts';

const CreateScheduleInputSchema = z.strictObject({
  workflowVersionId: z.string().uuid(),
  clientScheduleId: z.string().uuid(),
  name: z.string().min(1).max(120),
  definition: ScheduleDefinitionSchema,
  runnerDeviceId: z.string().uuid(),
  overlapPolicy: z.enum(['skip']).default('skip'),
  misfirePolicy: z.enum(['skip']).default('skip'),
  maxStartDelaySeconds: z.number().int().min(30).max(3600).default(300),
});

export async function createWorkflowScheduleAction(input: unknown) {
  const parsed = CreateScheduleInputSchema.safeParse(input);
  const token = await getAccessToken();
  if (!parsed.success || token === null) {
    return { ok: false as const, message: 'Invalid schedule request.' };
  }
  try {
    const response = await createWorkflowSchedule(
      token,
      parsed.data.workflowVersionId,
      {
        clientScheduleId: parsed.data.clientScheduleId,
        name: parsed.data.name,
        definition: parsed.data.definition,
        runnerDeviceId: parsed.data.runnerDeviceId,
        overlapPolicy: parsed.data.overlapPolicy,
        misfirePolicy: parsed.data.misfirePolicy,
        maxStartDelaySeconds: parsed.data.maxStartDelaySeconds,
      },
    );
    return { ok: true as const, scheduleId: (response.schedule as { id: string }).id };
  } catch (error: unknown) {
    if (error instanceof ControlPlaneError) {
      if (error.status === 409) {
        return { ok: false as const, message: 'A schedule with this ID already exists.' };
      }
      if (error.status === 400) {
        return { ok: false as const, message: 'The schedule definition is invalid.' };
      }
    }
    return { ok: false as const, message: 'The schedule could not be created.' };
  }
}

const ScheduleIdSchema = z.string().uuid();

export async function pauseWorkflowScheduleAction(scheduleId: string) {
  const validId = ScheduleIdSchema.safeParse(scheduleId);
  if (!validId.success) {
    return { ok: false as const, message: 'Invalid schedule ID.' };
  }
  const token = await getAccessToken();
  if (token === null) {
    return { ok: false as const, message: 'Authentication expired.' };
  }
  try {
    await pauseWorkflowSchedule(token, validId.data);
    return { ok: true as const };
  } catch {
    return { ok: false as const, message: 'The schedule could not be paused.' };
  }
}

export async function resumeWorkflowScheduleAction(scheduleId: string) {
  const validId = ScheduleIdSchema.safeParse(scheduleId);
  if (!validId.success) {
    return { ok: false as const, message: 'Invalid schedule ID.' };
  }
  const token = await getAccessToken();
  if (token === null) {
    return { ok: false as const, message: 'Authentication expired.' };
  }
  try {
    await resumeWorkflowSchedule(token, validId.data);
    return { ok: true as const };
  } catch {
    return { ok: false as const, message: 'The schedule could not be resumed.' };
  }
}

export async function archiveWorkflowScheduleAction(scheduleId: string) {
  const validId = ScheduleIdSchema.safeParse(scheduleId);
  if (!validId.success) {
    return { ok: false as const, message: 'Invalid schedule ID.' };
  }
  const token = await getAccessToken();
  if (token === null) {
    return { ok: false as const, message: 'Authentication expired.' };
  }
  try {
    await archiveWorkflowSchedule(token, validId.data);
    return { ok: true as const };
  } catch {
    return { ok: false as const, message: 'The schedule could not be archived.' };
  }
}
