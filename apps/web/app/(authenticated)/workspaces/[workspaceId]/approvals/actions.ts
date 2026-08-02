'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAccessToken } from '@/lib/server/auth-session';
import { decideApprovalRequest } from '@/lib/server/control-plane';

const DecisionInputSchema = z.strictObject({
  workspaceId: z.string().uuid(),
  approvalRequestId: z.string().uuid(),
  decision: z.enum(['approve', 'reject']),
});

export async function decideApprovalAction(input: unknown): Promise<void> {
  const parsed = DecisionInputSchema.safeParse(input);
  const token = await getAccessToken();
  if (!parsed.success || token === null) return;
  await decideApprovalRequest(
    token,
    parsed.data.approvalRequestId,
    parsed.data.decision,
    randomUUID(),
  );
  revalidatePath(`/workspaces/${parsed.data.workspaceId}/approvals`);
}
