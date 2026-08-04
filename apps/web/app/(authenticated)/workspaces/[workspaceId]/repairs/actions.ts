'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAccessToken } from '@/lib/server/auth-session';
import {
  applyLocatorRepairCandidate,
  decideRepairRequest,
  requestLocatorRepairCandidateTest,
} from '@/lib/server/control-plane';

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

const TestInputSchema = z.strictObject({
  workspaceId: z.string().uuid(),
  candidateId: z.string().uuid(),
});

export async function requestLocatorTestAction(input: unknown): Promise<void> {
  const parsed = TestInputSchema.safeParse(input);
  const token = await getAccessToken();
  if (!parsed.success || token === null) return;
  await requestLocatorRepairCandidateTest(
    token,
    parsed.data.candidateId,
    randomUUID(),
  );
  revalidatePath(`/workspaces/${parsed.data.workspaceId}/repairs`);
}

const ApplyInputSchema = z.strictObject({
  workspaceId: z.string().uuid(),
  proposalId: z.string().uuid(),
  candidateId: z.string().uuid(),
  targetDraftVersionId: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
});

export async function applyLocatorRepairAction(input: unknown): Promise<void> {
  const parsed = ApplyInputSchema.safeParse(input);
  const token = await getAccessToken();
  if (!parsed.success || token === null) return;
  await applyLocatorRepairCandidate(token, parsed.data.proposalId, {
    clientApplyId: randomUUID(),
    candidateId: parsed.data.candidateId,
    targetDraftVersionId: parsed.data.targetDraftVersionId,
    expectedRevision: parsed.data.expectedRevision,
  });
  revalidatePath(`/workspaces/${parsed.data.workspaceId}/repairs`);
}
