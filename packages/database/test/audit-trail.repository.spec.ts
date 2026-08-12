import { AuditSystemReasonSchema } from '@tasktwin/audit-trail';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { WorkspaceAuditTrailRepository } from '../src/index.js';

const EVENT_ID = '00000000-0000-4000-8000-000000000001';
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000002';

describe('WorkspaceAuditTrailRepository actor mapping', () => {
  it('round-trips every supported system actor reason', async () => {
    const findUnique = vi.fn();
    const repository = new WorkspaceAuditTrailRepository({
      workspaceAuditEvent: { findUnique },
    } as unknown as PrismaClient);

    for (const reason of AuditSystemReasonSchema.options) {
      findUnique.mockResolvedValueOnce({
        id: EVENT_ID,
        workspaceId: WORKSPACE_ID,
        sequence: 1,
        schemaVersion: 1,
        eventType: 'schedule.occurrence_dispatched',
        actorType: 'system',
        actorId: 'system',
        actorReason: reason,
        primaryEntityKind: 'workflow_schedule_occurrence',
        primaryEntityId: EVENT_ID,
        relatedEntities: [],
        occurredAt: new Date('2026-08-13T00:00:00.000Z'),
        sourceId: `actor-reason-${reason}`,
        correlationId: null,
        payload: {},
        payloadDigest: 'a'.repeat(64),
        previousHash: '0'.repeat(64),
        eventHash: 'b'.repeat(64),
        createdAt: new Date('2026-08-13T00:00:00.000Z'),
      });

      await expect(repository.getAuditEvent(EVENT_ID)).resolves.toMatchObject({
        actor: { type: 'system', reason },
      });
    }
  });
});
