'use server';

import { z } from 'zod';

import { getAccessToken } from '@/lib/server/auth-session';
import {
  ControlPlaneError,
  listAuditEvents,
  verifyAuditTrail,
} from '@/lib/server/control-plane';

const ListAuditEventsInputSchema = z.strictObject({
  workspaceId: z.string().uuid(),
  filters: z
    .record(z.string(), z.union([z.string(), z.array(z.string())]))
    .default({}),
});

export async function listAuditEventsAction(input: unknown) {
  const parsed = ListAuditEventsInputSchema.safeParse(input);
  const token = await getAccessToken();
  if (!parsed.success || token === null) {
    return { ok: false as const, message: 'Invalid audit request.' };
  }
  try {
    const result = await listAuditEvents(
      token,
      parsed.data.workspaceId,
      parsed.data.filters,
    );
    return {
      ok: true as const,
      events: result.events,
      nextCursor: result.nextCursor,
    };
  } catch (error: unknown) {
    if (error instanceof ControlPlaneError && error.status === 401) {
      return { ok: false as const, message: 'Authentication expired.' };
    }
    return { ok: false as const, message: 'Audit events could not be loaded.' };
  }
}

const VerifyAuditTrailInputSchema = z.strictObject({
  workspaceId: z.string().uuid(),
  sampleLimit: z.number().int().min(1).max(1000).default(200),
});

export async function verifyAuditTrailAction(input: unknown) {
  const parsed = VerifyAuditTrailInputSchema.safeParse(input);
  const token = await getAccessToken();
  if (!parsed.success || token === null) {
    return { ok: false as const, message: 'Invalid verification request.' };
  }
  try {
    const result = await verifyAuditTrail(token, parsed.data.workspaceId, {
      sampleLimit: parsed.data.sampleLimit,
    });
    return { ok: true as const, result };
  } catch (error: unknown) {
    if (error instanceof ControlPlaneError && error.status === 401) {
      return { ok: false as const, message: 'Authentication expired.' };
    }
    return { ok: false as const, message: 'Audit chain verification failed.' };
  }
}