'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAccessToken } from '@/lib/server/auth-session';
import { decideRepairRequest } from '@/lib/server/control-plane';

const DecisionInputSchema = z.strictObject({
  workspaceId: z.string().uuid(),
  repairRequestId: z.string().uuid(),
  decision: z.enum(['retry', 'abort']),
});

export async function decideRepairAction(input: unknown): Promise<void> {
  const parsed = DecisionInputSchema.safeParse(input);
  const token = await getAccessToken();
  if (!parsed.success || token === null) return;
  await decideRepairRequest(
    token,
    parsed.data.repairRequestId,
    parsed.data.decision,
    randomUUID(),
  );
  revalidatePath(`/workspaces/${parsed.data.workspaceId}/repairs`);
}
